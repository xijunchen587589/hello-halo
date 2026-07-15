/**
 * Request Converter: Anthropic -> OpenAI Responses API
 */

import type { AnthropicRequest, OpenAIResponsesRequest } from '../../types'
import { convertAnthropicMessagesToResponsesInput } from '../messages'
import {
  convertAnthropicToolsToResponses,
  convertAnthropicToolChoiceToResponses,
  convertAnthropicThinkingToResponsesReasoning
} from '../tools'
import { supportsVisionById } from '../../../../shared/constants/model-capabilities'
import { resolveOutputTokenLimit } from './max-tokens'

export interface ConversionResult {
  request: OpenAIResponsesRequest
  hasImages: boolean
  hasTools: boolean
}

/**
 * Convert Anthropic request to OpenAI Responses API request
 */
export function convertAnthropicToOpenAIResponses(anthropicRequest: AnthropicRequest): ConversionResult {
  // Mirror the Chat-Completions path: drop image content when the target
  // model has no vision capability so the Responses API does not reject
  // `input_image` parts. Symmetric handling keeps both paths consistent.
  const stripImages = !supportsVisionById(anthropicRequest.model)

  // Detect images on the original input so we can log/report accurately
  // even after stripping.
  const originalHadImages = (anthropicRequest.messages ?? []).some((m) => {
    if (!m || !Array.isArray(m.content)) return false
    return m.content.some((b) => {
      if (b.type === 'image') return true
      if (b.type === 'tool_result' && Array.isArray(b.content)) {
        return b.content.some((inner) => inner.type === 'image')
      }
      return false
    })
  })

  // Convert messages to input items
  const inputItems = convertAnthropicMessagesToResponsesInput(
    anthropicRequest.messages,
    anthropicRequest.system,
    { stripImages }
  )

  // Report on the original input shape — independent of post-strip state.
  const hasImages = originalHadImages

  // Convert tools
  const tools = convertAnthropicToolsToResponses(anthropicRequest.tools)
  const hasTools = !!tools && tools.length > 0

  // Build request - only include essential parameters
  const request: OpenAIResponsesRequest = {
    model: anthropicRequest.model,
    input: inputItems,
    stream: anthropicRequest.stream
  }

  // Forward the user-configured output length, mirroring the Chat Completions
  // path. The Responses API field is `max_output_tokens` and is part of the
  // public spec, so providers implementing the Responses endpoint accept it.
  // Without this, Halo's "max output tokens" setting is silently dropped for
  // any backend routed through the Responses API.
  const outputTokens = resolveOutputTokenLimit(anthropicRequest.max_tokens)
  if (outputTokens !== undefined) {
    request.max_output_tokens = outputTokens
  }

  // Add tools if present
  if (tools && tools.length > 0) {
    request.tools = tools
    request.tool_choice = convertAnthropicToolChoiceToResponses(anthropicRequest.tool_choice)
  }

  // Convert thinking -> reasoning (only when enabled; omit entirely when disabled)
  const reasoning = convertAnthropicThinkingToResponsesReasoning(anthropicRequest.thinking)
  if (reasoning) {
    request.reasoning = reasoning
  }

  if (stripImages && hasImages) {
    console.log(
      `[openai-compat] Stripped image content for non-vision model: ${anthropicRequest.model}`
    )
  }

  return {
    request,
    hasImages,
    hasTools
  }
}

/**
 * Simplified conversion that returns just the request
 * (for backward compatibility)
 */
export function convertRequest(anthropicRequest: AnthropicRequest): OpenAIResponsesRequest {
  return convertAnthropicToOpenAIResponses(anthropicRequest).request
}
