/**
 * apps/runtime/sources -- WecomBotSource
 *
 * Event source adapter that connects to WeCom's intelligent bot WebSocket API
 * (`wss://openws.work.weixin.qq.com`) to receive inbound messages and enable
 * bidirectional communication between digital humans (automation apps) and
 * enterprise WeChat users.
 *
 * Protocol (aligned with @wecom/aibot-node-sdk):
 * - WebSocket long connection (JSON, no XML/AES)
 * - `aibot_subscribe` for authentication (bot_id + secret)
 * - `aibot_msg_callback` for receiving messages
 * - `aibot_respond_msg` for replying (same req_id)
 * - Application-level heartbeat: `{ cmd: "ping" }` every 30 seconds
 * - Only ONE WebSocket connection per bot allowed
 * - req_id expires after 5 minutes (WeCom protocol limit)
 *
 * Lifecycle:
 * - start(): connects WebSocket, subscribes, starts heartbeat
 * - stop(): closes WebSocket, clears all timers and state
 * - replyToChat(): sends a reply to a specific chat (used by runtime after run completion)
 */

import WebSocket from 'ws'
import type { EventSourceAdapter, AutomationEventInput } from '../event-types'
import type { ImChannelAdapter } from '../../../../shared/types/im-channel'
import type { WecomBotConfig } from '../../../../shared/types/notification-channels'
import type { InboundMessage, ReplyHandle } from '../../../../shared/types/inbound-message'
import { dispatchInboundMessage } from '../dispatch-inbound'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_WS_URL = 'wss://openws.work.weixin.qq.com'
const HEARTBEAT_INTERVAL_MS = 30_000    // 30 seconds
const RECONNECT_BASE_DELAY_MS = 2_000   // 2 seconds
const RECONNECT_MAX_DELAY_MS = 30_000   // 30 seconds cap
const MAX_RECONNECT_ATTEMPTS = 100
const REQ_ID_TTL_MS = 5 * 60 * 1000    // 5 minutes (WeCom protocol limit)
const REQ_ID_CLEANUP_INTERVAL_MS = 60_000 // 1 minute

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReqIdEntry {
  reqId: string
  ts: number
}

/** Callback to resolve the current WecomBot config at runtime. */
export type WecomBotConfigResolver = () => WecomBotConfig | null

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let reqIdCounter = 0

/** Generate a prefixed req_id (same pattern as official SDK's generateReqId). */
function generateReqId(prefix: string): string {
  return `${prefix}_${Date.now()}_${++reqIdCounter}`
}

// ---------------------------------------------------------------------------
// Source Implementation
// ---------------------------------------------------------------------------

export class WecomBotSource implements EventSourceAdapter, ImChannelAdapter {
  readonly id = 'wecom-bot'
  readonly type = 'wecom-bot' as const
  readonly channel = 'wecom-bot'

  private emitFn: ((event: AutomationEventInput) => void) | null = null
  private configResolver: WecomBotConfigResolver
  private ws: WebSocket | null = null
  private active = false
  private reconnectAttempts = 0
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reqIdCleanupTimer: ReturnType<typeof setInterval> | null = null

  /**
   * chatId → { reqId, ts } mapping for replies.
   * Updated on every incoming message. Entries expire after 5 minutes.
   */
  private reqIdMap = new Map<string, ReqIdEntry>()

  constructor(configResolver: WecomBotConfigResolver) {
    this.configResolver = configResolver
  }

  // ── EventSourceAdapter Interface ────────────────────────────────────────

  start(emit: (event: AutomationEventInput) => void): void {
    this.emitFn = emit
    this.active = true

    const config = this.configResolver()
    if (!config || !config.enabled || !config.botId || !config.secret) {
      console.log('[WecomBotSource] Not configured or disabled — skipping start')
      return
    }

    this.connect(config)

    // Start periodic cleanup of expired req_id entries
    this.reqIdCleanupTimer = setInterval(() => this.cleanupExpiredReqIds(), REQ_ID_CLEANUP_INTERVAL_MS)

    console.log('[WecomBotSource] Started')
  }

  stop(): void {
    this.active = false
    this.emitFn = null

    // Clear all timers
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.reqIdCleanupTimer) {
      clearInterval(this.reqIdCleanupTimer)
      this.reqIdCleanupTimer = null
    }

    // Terminate WebSocket immediately (no graceful close handshake)
    this.destroySocket()

    this.reqIdMap.clear()
    this.reconnectAttempts = 0
    console.log('[WecomBotSource] Stopped')
  }

  // ── Public API for Reply ────────────────────────────────────────────────

  /**
   * Send a reply to a specific WeCom chat.
   *
   * Called by the runtime after a run completes, to send the final result
   * back to the WeChat conversation that triggered the run.
   *
   * @param chatId - The chat ID from the triggering event payload
   * @param text - The reply text (supports Markdown)
   * @returns true if sent successfully, false otherwise
   */
  replyToChat(chatId: string, text: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[WecomBotSource] Cannot reply: WebSocket not connected')
      return false
    }

    const entry = this.reqIdMap.get(chatId)
    if (!entry) {
      console.warn(`[WecomBotSource] Cannot reply: no req_id mapping for chat ${chatId}`)
      return false
    }

    // Check if req_id has expired
    if (Date.now() - entry.ts > REQ_ID_TTL_MS) {
      this.reqIdMap.delete(chatId)
      console.warn(`[WecomBotSource] Cannot reply: req_id expired for chat ${chatId}`)
      return false
    }

    try {
      this.ws.send(JSON.stringify({
        cmd: 'aibot_respond_msg',
        headers: { req_id: entry.reqId },
        body: {
          msgtype: 'markdown',
          markdown: { content: text },
        },
      }))
      console.log(`[WecomBotSource] Reply sent to chat ${chatId}`)
      return true
    } catch (err) {
      console.error(`[WecomBotSource] Failed to send reply:`, err)
      return false
    }
  }

  /**
   * Check if the WebSocket is currently connected and ready.
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  // ── ImChannelAdapter: Proactive Push ──────────────────────────────────────

  /**
   * Push a message proactively to a WeCom chat.
   *
   * Uses `aibot_send_msg` (not `aibot_respond_msg`), which does NOT require
   * a req_id from an inbound message. The req_id is self-generated.
   *
   * Protocol constraints (from WeCom docs):
   * - User must have sent at least one message to the bot in the target chat
   * - Rate limit: 30 msgs/min, 1000 msgs/hour (shared with respond_msg)
   * - No streaming support
   * - Supported types: markdown, template_card, file, image, voice, video
   *
   * @param chatId - Platform-side conversation ID
   * @param text - Message content (Markdown format)
   * @param chatType - 'direct' or 'group'
   * @returns true if sent successfully, false otherwise
   */
  pushToChat(chatId: string, text: string, chatType: 'direct' | 'group'): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[WecomBotSource] Cannot push: WebSocket not connected')
      return false
    }

    try {
      this.ws.send(JSON.stringify({
        cmd: 'aibot_send_msg',
        headers: { req_id: generateReqId('aibot_send_msg') },
        body: {
          chatid: chatId,
          chat_type: chatType === 'direct' ? 1 : 2,
          msgtype: 'markdown',
          markdown: { content: text },
        },
      }))
      console.log(`[WecomBotSource] Push sent to chat ${chatId} (${chatType})`)
      return true
    } catch (err) {
      console.error(`[WecomBotSource] Failed to push message:`, err)
      return false
    }
  }

  // ── Reconnect with fresh config ─────────────────────────────────────────

  /**
   * Reconnect with potentially updated config.
   * Called when wecomBot config changes in settings.
   */
  reconnectWithConfig(): void {
    if (!this.active) return

    // Terminate existing connection immediately
    this.destroySocket()
    this.stopHeartbeat()
    this.reconnectAttempts = 0

    const config = this.configResolver()
    if (!config || !config.enabled || !config.botId || !config.secret) {
      console.log('[WecomBotSource] Config disabled or incomplete — disconnecting')
      return
    }

    this.connect(config)
  }

  // ── WebSocket Connection ────────────────────────────────────────────────

  private connect(config: WecomBotConfig): void {
    // Guard: terminate any lingering connection before creating a new one.
    // Use terminate() (not close()) to immediately destroy the TCP socket,
    // preventing the old connection from receiving stale frames from WeCom
    // that contain reserved/non-standard opcodes (e.g. opcode 3).
    this.destroySocket()

    // Cancel pending reconnect timer to prevent duplicate connections
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    const wsUrl = config.wsUrl || DEFAULT_WS_URL
    console.log(`[WecomBotSource] Connecting to ${wsUrl}...`)

    try {
      this.ws = new WebSocket(wsUrl, {
        perMessageDeflate: false,
        skipUTF8Validation: true,
      })
    } catch (err) {
      console.error(`[WecomBotSource] Failed to create WebSocket:`, err)
      this.scheduleReconnect()
      return
    }

    this.ws.on('open', () => {
      console.log('[WecomBotSource] Connected, subscribing...')
      this.reconnectAttempts = 0

      // Send aibot_subscribe (same format as official SDK)
      this.ws!.send(JSON.stringify({
        cmd: 'aibot_subscribe',
        headers: { req_id: generateReqId('aibot_subscribe') },
        body: {
          bot_id: config.botId,
          secret: config.secret,
        },
      }))
    })

    this.ws.on('message', (data: WebSocket.Data) => {
      this.handleMessage(data)
    })

    // Respond to server-initiated WebSocket-level pings (same as official SDK)
    this.ws.on('ping', () => {
      this.ws?.pong()
    })

    this.ws.on('close', (code: number, reason: Buffer) => {
      console.log(`[WecomBotSource] Connection closed (code=${code}, reason=${reason.toString()})`)
      this.stopHeartbeat()
      if (this.active) {
        this.scheduleReconnect()
      }
    })

    this.ws.on('error', (err: Error) => {
      console.error('[WecomBotSource] WebSocket error:', err.message)
    })
  }

  /**
   * Immediately destroy the current WebSocket connection.
   * Uses terminate() instead of close() to skip the graceful close
   * handshake — preventing stale frames from being received on the
   * old socket while a new connection is being established.
   */
  private destroySocket(): void {
    if (this.ws) {
      try {
        this.ws.removeAllListeners()
        this.ws.terminate()
      } catch { /* ignore */ }
      this.ws = null
    }
  }

  private handleMessage(data: WebSocket.Data): void {
    let msg: any
    try {
      msg = JSON.parse(typeof data === 'string' ? data : data.toString())
    } catch {
      console.warn('[WecomBotSource] Invalid JSON received')
      return
    }

    // ── Authentication response ──────────────────────────────
    // The official SDK checks for req_id starting with 'aibot_subscribe'
    // The response format is: { headers: { req_id }, errcode: 0, errmsg: "ok" }
    const reqId = msg.headers?.req_id ?? ''
    if (typeof reqId === 'string' && reqId.startsWith('aibot_subscribe')) {
      if (msg.errcode === 0) {
        console.log('[WecomBotSource] Subscribed successfully')
        this.startHeartbeat()
      } else {
        console.error(`[WecomBotSource] Subscribe failed: errcode=${msg.errcode} errmsg=${msg.errmsg}`)
        // Don't reconnect on auth failure — config is wrong
        this.destroySocket()
      }
      return
    }

    // ── Heartbeat ack ────────────────────────────────────────
    if (typeof reqId === 'string' && reqId.startsWith('ping')) {
      // Heartbeat ack received — nothing to do
      return
    }

    // ── Command-based routing ────────────────────────────────
    console.log(`[WecomBotSource] Frame: cmd=${msg.cmd ?? '(none)'}, reqId=${reqId.substring(0, 30)}`)
    switch (msg.cmd) {
      case 'aibot_msg_callback': {
        this.handleInboundMessage(msg)
        break
      }

      case 'aibot_event_callback': {
        const eventType = msg.body?.event?.eventtype ?? msg.body?.event_type ?? 'unknown'
        console.log(`[WecomBotSource] Event: ${eventType}`)
        break
      }

      default:
        // Unknown frame — log and ignore (same as official SDK)
        if (msg.cmd) {
          console.log(`[WecomBotSource] Unknown cmd: ${msg.cmd}`)
        }
        break
    }
  }

  private handleInboundMessage(msg: any): void {
    if (!this.active) return

    const body = msg.body
    if (!body) return

    const reqId = msg.headers?.req_id
    const senderId = body.from?.userid
    const senderName = body.from?.name ?? senderId
    // For single chats, chatid may be absent — use sender's userid as chatId
    const chatId = body.chatid ?? senderId
    const chatType = body.chattype // 'single' or 'group'
    const msgId = body.msgid
    const msgType = body.msgtype

    if (!senderId || !chatId) return

    // Store req_id mapping for replies
    if (reqId) {
      this.reqIdMap.set(chatId, { reqId, ts: Date.now() })
    }

    // Extract text content
    const text = this.extractText(body)

    console.log(
      `[WecomBotSource] Message: chat=${chatId}, type=${chatType}, ` +
      `from=${senderName}, msgType=${msgType}, len=${text.length}`
    )

    // ── Construct normalized InboundMessage ──────────────────────────
    const inbound: InboundMessage = {
      body: text,
      from: senderId,
      fromName: senderName,
      channel: 'wecom-bot',
      chatType: chatType === 'group' ? 'group' : 'direct',
      chatId,
      messageId: msgId,
      timestamp: Date.now(),
    }

    // ── Construct ReplyHandle (wraps replyToChat with TTL-aware fallback) ──
    // Normalize chatType once for the closure (body.chattype is 'single' | 'group')
    const chatTypeNorm: 'direct' | 'group' = chatType === 'group' ? 'group' : 'direct'
    const reply: ReplyHandle = {
      channel: 'wecom-bot',
      chatId,
      replyTtlMs: REQ_ID_TTL_MS,
      send: async (replyText: string): Promise<void> => {
        // Prefer synchronous reply (aibot_respond_msg, same req_id) — faster delivery.
        const replied = this.replyToChat(chatId, replyText)
        if (replied) return

        // req_id expired or WebSocket unavailable — fall back to proactive push.
        // aibot_send_msg has no TTL constraint and can be sent at any time.
        console.log(`[WecomBotSource] req_id expired for chat ${chatId}, falling back to pushToChat`)
        const pushed = this.pushToChat(chatId, replyText, chatTypeNorm)
        if (!pushed) {
          throw new Error(`[WecomBotSource] Both replyToChat and pushToChat failed for chat ${chatId}`)
        }
      },
    }

    // ── Dispatch to core (fire-and-forget) ───────────────────────────
    dispatchInboundMessage(inbound, reply).catch((err) => {
      console.error(`[WecomBotSource] Dispatch error: chat=${chatId}`, err)
    })

    // ── Also emit event into EventRouter for apps with explicit wecom subscriptions ──
    if (this.emitFn) {
      this.emitFn({
        type: 'wecom.message',
        source: this.id,
        payload: {
          chatId,
          chatType,
          senderId,
          msgId,
          msgType,
          text,
          reqId,
          // Omit raw body to avoid leaking full message content into event store
        },
        dedupKey: msgId ? `wecom:${msgId}` : undefined,
      })
    }
  }

  private extractText(body: any): string {
    switch (body.msgtype) {
      case 'text':
        return body.text?.content ?? ''
      case 'image':
        return '(图片)'
      case 'voice':
        return '(语音)'
      case 'file':
        return `(文件: ${body.file?.filename ?? '未知'})`
      case 'video':
        return '(视频)'
      case 'link':
        return `(链接: ${body.link?.title ?? body.link?.url ?? ''})`
      default:
        return `(${body.msgtype ?? '未知消息类型'})`
    }
  }

  // ── Heartbeat ───────────────────────────────────────────────────────────

  /**
   * Start application-level heartbeat using JSON messages.
   * Format: { cmd: "ping", headers: { req_id: "ping_xxxxx" } }
   * This matches the official @wecom/aibot-node-sdk protocol.
   *
   * Note: Do NOT use WebSocket-level ws.ping() — that is for responding
   * to server-initiated pings (handled in the 'ping' event listener).
   */
  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({
            cmd: 'ping',
            headers: { req_id: generateReqId('ping') },
          }))
        } catch {
          // If send fails, connection is likely broken
        }
      }
    }, HEARTBEAT_INTERVAL_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  // ── Reconnect ───────────────────────────────────────────────────────────

  private scheduleReconnect(): void {
    if (!this.active) return

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error(`[WecomBotSource] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached, giving up`)
      return
    }

    // Exponential backoff: 2s → 4s → 8s → 16s → 30s cap
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts),
      RECONNECT_MAX_DELAY_MS
    )
    this.reconnectAttempts++

    console.log(`[WecomBotSource] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`)

    this.reconnectTimer = setTimeout(() => {
      if (!this.active) return
      const config = this.configResolver()
      if (config && config.enabled && config.botId && config.secret) {
        this.connect(config)
      }
    }, delay)
  }

  // ── req_id Cleanup ──────────────────────────────────────────────────────

  private cleanupExpiredReqIds(): void {
    const now = Date.now()
    for (const [chatId, entry] of this.reqIdMap) {
      if (now - entry.ts > REQ_ID_TTL_MS) {
        this.reqIdMap.delete(chatId)
      }
    }
  }
}
