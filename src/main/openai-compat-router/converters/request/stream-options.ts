/**
 * Shared builder for the OpenAI-compatible `stream_options` object.
 *
 * OpenAI-compatible gateways (including litellm and the OpenAI public API) do
 * not return token usage in streamed chunks unless the request explicitly opts
 * in via `stream_options: { include_usage: true }`. Without this flag, every
 * streamed response has an empty `chunk.usage`, so the downstream accumulator
 * sees zero tokens and the UI's `TokenUsageIndicator` renders all zeros.
 *
 * Both the Chat Completions and Responses API converters delegate to this
 * helper so the contract is applied once at the protocol boundary.
 */

export function buildStreamOptionsIncludeUsage(): { include_usage: true } {
  return { include_usage: true }
}
