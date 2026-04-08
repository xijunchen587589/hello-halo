/**
 * Inbound Message — Normalized IM message type
 *
 * Platform-agnostic message format produced by channel adapters (WeCom Bot,
 * Feishu Bot, DingTalk Bot, etc.). The core runtime only knows this type —
 * it never sees any platform-specific fields or SDK objects.
 *
 * Design principles:
 * - All fields are platform-neutral; adapters handle the mapping
 * - No credentials, protocol details, or platform SDK objects
 * - recentHistory is optional — some platforms support history pull, some don't
 */

// ============================================
// InboundMessage
// ============================================

/** Normalized inbound message from any IM channel adapter. */
export interface InboundMessage {
  /** Message text body */
  body: string
  /** Sender identifier (platform-side user ID) */
  from: string
  /** Sender display name (used as sender label in prompts) */
  fromName?: string
  /** Channel identifier: 'wecom-bot' | 'feishu-bot' | 'dingtalk-bot' | ... */
  channel: string
  /** Conversation type */
  chatType: 'direct' | 'group'
  /** Platform-side conversation ID (group ID or direct-chat ID) */
  chatId: string
  /** Protocol-provided conversation name (group name / channel name), if available */
  chatName?: string
  /** Platform-side message ID (used for dedup) */
  messageId?: string
  /** Message timestamp (epoch ms) */
  timestamp: number
  /** Optional recent history provided by the adapter (if the platform API supports it) */
  recentHistory?: InboundHistoryEntry[]
}

/** A single entry in the optional recent history array. */
export interface InboundHistoryEntry {
  sender: string
  body: string
  timestamp: number
}

// ============================================
// ReplyHandle
// ============================================

/**
 * Reply capability provided by a channel adapter.
 *
 * The core runtime calls `send(text)` to reply — it never knows whether
 * the underlying transport is WebSocket, HTTP API, or something else.
 * The adapter binds the target conversation (chatId, reqId, etc.) at
 * construction time.
 *
 * Minimal interface: only `send` is required. `sendTyping` is optional
 * for platforms that support typing indicators.
 *
 * Channel TTL notes:
 * - WeCom bot: req_id expires after 5 minutes — adapter auto-falls back to pushToChat()
 * - Feishu/DingTalk: similar protocol-level TTLs — adapters handle internally
 * - Webhook/Schedule: no TTL — reply path is always available
 *
 * Adapters are responsible for TTL fallback internally; callers use `send()` uniformly.
 */
export interface ReplyHandle {
  /** Send a text reply to the originating conversation. */
  send(text: string): Promise<void>
  /** Optional: send a "typing" indicator. */
  sendTyping?(): Promise<void>
  /** Channel identifier (for logging). */
  channel: string
  /** Target conversation ID (for logging). */
  chatId: string
  /**
   * TTL (ms) of the synchronous reply path for this channel.
   * After this duration, `send()` will automatically fall back to a proactive push.
   * Undefined means no TTL — the synchronous reply path is always valid.
   *
   * Examples:
   *   WeCom bot: 5 * 60 * 1000 (req_id expires after 5 minutes)
   *   Webhook:   undefined (HTTP response is immediate, no TTL)
   */
  replyTtlMs?: number
}
