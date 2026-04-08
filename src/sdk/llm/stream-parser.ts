/**
 * @module llm/stream-parser
 * SSE (Server-Sent Events) stream parser for LLM provider responses.
 * Handles chunked data, multi-line payloads, and the [DONE] sentinel.
 * @license MIT
 */

/**
 * Parse an SSE stream from a fetch Response into a sequence of JSON objects.
 *
 * Handles:
 * - `data:` lines containing JSON payloads
 * - `event:` prefixed lines (returned as `__event` field on the next data object)
 * - Empty lines and SSE comments (`:` prefix) — skipped
 * - `[DONE]` sentinel — terminates the generator
 * - Chunked data split across network packets
 */
export async function* parseSSEStream(
  response: Response,
  signal?: AbortSignal,
): AsyncGenerator<Record<string, unknown>, void, undefined> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Response body is not readable');
  }

  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let currentEvent: string | undefined;

  try {
    while (true) {
      if (signal?.aborted) {
        break;
      }

      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines from the buffer
      const lines = buffer.split('\n');
      // The last element may be an incomplete line — keep it in the buffer
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trimEnd();

        // Empty line — SSE event boundary (no-op for our purposes)
        if (line === '') {
          continue;
        }

        // SSE comment — skip
        if (line.startsWith(':')) {
          continue;
        }

        // Event type line
        if (line.startsWith('event:')) {
          currentEvent = line.slice(6).trim();
          continue;
        }

        // Data line
        if (line.startsWith('data:')) {
          const data = line.slice(5).trim();

          // [DONE] sentinel — end of stream
          if (data === '[DONE]') {
            return;
          }

          // Skip empty data
          if (data === '') {
            continue;
          }

          try {
            const parsed = JSON.parse(data) as Record<string, unknown>;
            // Attach the event type if one was specified
            if (currentEvent !== undefined) {
              parsed.__event = currentEvent;
              currentEvent = undefined;
            }
            yield parsed;
          } catch {
            // Malformed JSON — skip this chunk. This can happen with
            // partial data across chunk boundaries, though our line-based
            // parsing should handle most cases. Log for debugging in dev.
            if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
              console.warn('[stream-parser] Failed to parse SSE data:', data);
            }
          }
          continue;
        }

        // Lines that don't match any known prefix are ignored per the SSE spec
      }
    }
  } finally {
    reader.releaseLock();
  }
}
