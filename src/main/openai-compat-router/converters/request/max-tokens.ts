/**
 * Output-Length Parameter Resolution
 *
 * Centralized normalization for the `max_tokens` value that arrives on an
 * Anthropic-shaped request. Both the Chat Completions and Responses API
 * converters need the same gating + integer hygiene, so the logic lives here
 * to avoid drift between the two paths.
 *
 * Responsibilities:
 *   - Drop non-positive values (0, negative) — let the provider use its own
 *     default rather than emitting an invalid cap.
 *   - Truncate fractional values to an integer. `AnthropicRequest.max_tokens`
 *     is typed `number` (not `integer`), and although the Halo UI steppers and
 *     the Anthropic SDK both constrain to integers, this is the protocol
 *     boundary where untrusted upstream values are normalized once before
 *     being fanned out to provider-specific fields.
 */

/**
 * Normalize the Anthropic `max_tokens` into a positive integer suitable for
 * an OpenAI-compatible output-length field, or return `undefined` when the
 * value should be omitted entirely.
 *
 * @param maxTokens - The raw `max_tokens` from the Anthropic request.
 * @returns A positive integer, or `undefined` to omit the field.
 */
export function resolveOutputTokenLimit(maxTokens: number | undefined | null): number | undefined {
  if (typeof maxTokens !== 'number' || !Number.isFinite(maxTokens)) {
    return undefined
  }
  // Truncate any fractional part — OpenAI-compatible APIs require an integer
  // and reject (e.g. HTTP 400) non-integer values for max_tokens /
  // max_completion_tokens / max_output_tokens.
  const truncated = Math.trunc(maxTokens)
  // Truncation can collapse values in (0, 1) to 0, which is not a valid cap.
  return truncated > 0 ? truncated : undefined
}
