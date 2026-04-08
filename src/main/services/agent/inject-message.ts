/**
 * Agent Module - Inject Message
 *
 * Sends a mid-turn user message into an active V2 session's input stream.
 * The message is enqueued by the CC subprocess at the next tool round boundary,
 * functionally equivalent to the official CC REPL's concurrent message handling.
 *
 * Mid-turn injection does NOT produce a separate turn/result — CC absorbs the
 * injected message into the current turn's context and continues to a single result.
 * Therefore this module simply persists the message and sends it; no continuation
 * tracking or turn suppression is needed.
 */

import { v2Sessions } from './session-manager'
import { addMessage } from '../conversation.service'

/**
 * Inject a plain-text message into an active V2 session mid-turn.
 *
 * 1. Persists the message immediately (source: 'injection')
 * 2. Sends to CC subprocess via v2Session.send()
 *
 * CC absorbs this at the next tool boundary within the current turn.
 * The turn completes normally with a single result — no extra handling needed.
 *
 * @param conversationId - Target conversation
 * @param message - Plain text message to inject (images not supported mid-turn)
 * @throws Error if no active V2 session exists for this conversation
 */
export function injectMessage(conversationId: string, message: string): void {
  const v2SessionInfo = v2Sessions.get(conversationId)
  if (!v2SessionInfo) {
    throw new Error(`No active V2 session for conversation: ${conversationId}`)
  }

  // Persist immediately with source:'injection' so it appears in conversation history
  addMessage(v2SessionInfo.spaceId, conversationId, {
    role: 'user',
    content: message,
    source: 'injection',
  })

  // Send to CC — absorbed at next tool boundary within the current turn
  v2SessionInfo.session.send(message)
  console.log(`[Agent][${conversationId}] Mid-turn message injected and persisted (${message.length} chars)`)
}
