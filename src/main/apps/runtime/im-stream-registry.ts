/**
 * apps/runtime -- IM Stream Registry
 *
 * Session-scoped registry that maps conversationId → the active round's
 * StreamingHandle. Allows out-of-band callers (notably stopImSession) to
 * terminate an in-flight WeCom stream without needing access to the original
 * dispatch closure.
 *
 * Architecture:
 *   dispatch-inbound.ts  → set()     (writes the round's streaming handle)
 *   app-chat.ts          → clear()   (clears on round completion / error)
 *   app-chat.ts (stop)   → get()     (reads to finish/dispose on user stop)
 *
 * Lifecycle:
 *   - Set on every inbound IM dispatch where reply.streaming is present.
 *   - Overwrites the previous entry — only the LATEST round's handle is
 *     reachable, which is correct because a new inbound message either
 *     starts a new round (idle) or buffers as supplement (busy).
 *   - Cleared in sendAppChatMessage's finally block (round complete) and in
 *     clearSessionByConversationId (history wipe). Entries are NOT persisted.
 *
 * Only IM-originated sessions have entries; native Halo chat and automation
 * runs use fire-and-forget streaming without a registry hook.
 */

import type { StreamingHandle } from '../../../shared/types/inbound-message'

// ============================================
// Registry (module-level singleton)
// ============================================

const registry = new Map<string, StreamingHandle>()

/**
 * Set (or overwrite) the active round's streaming handle for a conversation.
 * Called by dispatch-inbound.ts when reply.streaming is present.
 */
export function setImStreamHandle(conversationId: string, handle: StreamingHandle): void {
  registry.set(conversationId, handle)
}

/**
 * Get the active round's streaming handle for a conversation.
 * Returns undefined when the round is non-streaming or has already completed.
 */
export function getImStreamHandle(conversationId: string): StreamingHandle | undefined {
  return registry.get(conversationId)
}

/**
 * Clear the streaming handle for a conversation.
 * Called on round completion, session reset, and session removal.
 */
export function clearImStreamHandle(conversationId: string): void {
  registry.delete(conversationId)
}

/**
 * Clear all streaming handles. Used during shutdown cleanup.
 */
export function clearAllImStreamHandles(): void {
  registry.clear()
}
