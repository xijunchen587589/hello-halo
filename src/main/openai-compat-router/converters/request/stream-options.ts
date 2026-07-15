/**
 * Build the OpenAI-compatible `stream_options: { include_usage: true }` object.
 *
 * Why this exists (issue #181): OpenAI-compat gateways (litellm, OpenAI public
 * Chat Completions API) only return token usage in the final streamed chunk when
 * the request explicitly opts in. Without this flag, `chunk.usage` is empty for
 * every streamed response, so the downstream accumulator sees zero tokens and
 * the UI's `TokenUsageIndicator` renders all zeros.
 *
 * Returned as a function (not a shared constant) so each caller gets a fresh
 * object and cannot accidentally mutate state shared across requests. Both the
 * Chat Completions and Responses API converters delegate to this helper so the
 * contract is applied once at the protocol boundary.
 */

export function buildStreamOptionsIncludeUsage(): { include_usage: true } {
  return { include_usage: true }
}
