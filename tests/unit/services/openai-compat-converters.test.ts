/**
 * Unit tests for the OpenAI-compat request converters — max_tokens forwarding.
 *
 * Scope (issue #137):
 *   - Chat Completions path routes `max_tokens` to the correct field depending
 *     on whether the target model is an OpenAI reasoning model
 *     (`max_completion_tokens`) or a standard model (`max_tokens`).
 *   - Responses API path forwards `max_output_tokens` (part of the public spec)
 *     so the user's Halo "max output tokens" setting is honored for backends
 *     routed through the Responses endpoint.
 *   - `isReasoningModelById` correctly classifies the OpenAI reasoning family
 *     (o1/o3/o4-mini, gpt-5-thinking variants) and avoids the `gpt-4o-1`
 *     false-positive trap.
 *
 * These tests live under the canonical `tests/unit/services/` path so they are
 * picked up by the project vitest config (include: 'unit/<glob>.test.ts').
 * The colocated `src/main/openai-compat-router/__tests__/converters.test.ts`
 * is a legacy file and is kept in sync with the same invariants, but only this
 * file is part of the mandatory pre-handoff validation run.
 */

import { describe, it, expect } from 'vitest'
import {
  convertAnthropicToOpenAIChat,
  convertAnthropicToOpenAIResponses
} from '../../../src/main/openai-compat-router/converters'
import { resolveOutputTokenLimit } from '../../../src/main/openai-compat-router/converters/request/max-tokens'
import type { AnthropicRequest } from '../../../src/main/openai-compat-router/types'
import { isReasoningModelById } from '../../../src/shared/constants/model-capabilities'

describe('Chat Completions — max_tokens forwarding (issue #137)', () => {
  it('routes max_tokens to max_completion_tokens for OpenAI reasoning models', () => {
    // The OpenAI reasoning family (o1/o3/o4-mini, gpt-5-thinking) rejects
    // `max_tokens` with HTTP 400. The converter must emit
    // `max_completion_tokens` so the user's Halo "max output tokens" setting
    // is honored without breaking the request.
    const request: AnthropicRequest = {
      model: 'o3-mini',
      max_tokens: 32000,
      messages: [{ role: 'user', content: 'Hello' }]
    }

    const result = convertAnthropicToOpenAIChat(request)

    expect(result.request.max_completion_tokens).toBe(32000)
    expect(result.request.max_tokens).toBeUndefined()
  })

  it('keeps max_tokens for standard (non-reasoning) models', () => {
    const request: AnthropicRequest = {
      model: 'gpt-4o',
      max_tokens: 4096,
      messages: [{ role: 'user', content: 'Hello' }]
    }

    const result = convertAnthropicToOpenAIChat(request)

    expect(result.request.max_tokens).toBe(4096)
    expect(result.request.max_completion_tokens).toBeUndefined()
  })

  it('keeps max_tokens for gpt-4o-1 (non-reasoning, starts-with-"o" trap)', () => {
    // Guards against a naive startsWith('o') check trapping "gpt-4o-1".
    // The detector requires the family prefix to end on a token boundary.
    const request: AnthropicRequest = {
      model: 'gpt-4o-1',
      max_tokens: 4096,
      messages: [{ role: 'user', content: 'Hello' }]
    }

    const result = convertAnthropicToOpenAIChat(request)

    expect(result.request.max_tokens).toBe(4096)
    expect(result.request.max_completion_tokens).toBeUndefined()
  })

  it('routes to max_completion_tokens for gpt-5-thinking variants', () => {
    const request: AnthropicRequest = {
      model: 'gpt-5-thinking-2026-01-01',
      max_tokens: 16000,
      messages: [{ role: 'user', content: 'Hello' }]
    }

    const result = convertAnthropicToOpenAIChat(request)

    expect(result.request.max_completion_tokens).toBe(16000)
    expect(result.request.max_tokens).toBeUndefined()
  })

  it('omits both fields when max_tokens is not a positive value', () => {
    // Non-positive values must not be forwarded so providers fall back to
    // their own defaults rather than receiving an invalid zero/negative cap.
    const request: AnthropicRequest = {
      model: 'gpt-4o',
      max_tokens: 0,
      messages: [{ role: 'user', content: 'Hello' }]
    }

    const result = convertAnthropicToOpenAIChat(request)

    expect(result.request.max_tokens).toBeUndefined()
    expect(result.request.max_completion_tokens).toBeUndefined()
  })

  it('truncates fractional max_tokens to an integer', () => {
    // OpenAI-compatible APIs require an integer for max_tokens /
    // max_completion_tokens; a fractional value triggers HTTP 400. The
    // converter normalizes at the protocol boundary.
    const request: AnthropicRequest = {
      model: 'gpt-4o',
      max_tokens: 4096.9,
      messages: [{ role: 'user', content: 'Hello' }]
    }

    const result = convertAnthropicToOpenAIChat(request)

    expect(result.request.max_tokens).toBe(4096)
  })
})

describe('Responses API — max_output_tokens forwarding (issue #137)', () => {
  it('forwards max_output_tokens so the user setting is honored', () => {
    // `max_output_tokens` is part of the Responses API public spec. Without
    // forwarding, Halo's "max output tokens" setting is silently dropped for
    // any backend routed through the Responses API.
    const request: AnthropicRequest = {
      model: 'claude-3-opus',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello!' }]
    }

    const result = convertAnthropicToOpenAIResponses(request)

    expect(result.request.max_output_tokens).toBe(1024)
  })

  it('omits max_output_tokens when max_tokens is not a positive value', () => {
    const request: AnthropicRequest = {
      model: 'claude-3-opus',
      max_tokens: 0,
      messages: [{ role: 'user', content: 'Hello!' }]
    }

    const result = convertAnthropicToOpenAIResponses(request)

    expect(result.request.max_output_tokens).toBeUndefined()
  })

  it('truncates fractional max_tokens to an integer', () => {
    const request: AnthropicRequest = {
      model: 'claude-3-opus',
      max_tokens: 1024.5,
      messages: [{ role: 'user', content: 'Hello!' }]
    }

    const result = convertAnthropicToOpenAIResponses(request)

    expect(result.request.max_output_tokens).toBe(1024)
  })
})

describe('resolveOutputTokenLimit', () => {
  it('returns the value as-is when it is already a positive integer', () => {
    expect(resolveOutputTokenLimit(1)).toBe(1)
    expect(resolveOutputTokenLimit(8192)).toBe(8192)
  })

  it('truncates fractional values to the integer part', () => {
    expect(resolveOutputTokenLimit(1024.9)).toBe(1024)
    expect(resolveOutputTokenLimit(0.5)).toBeUndefined() // truncates to 0 → not positive
  })

  it('returns undefined for non-positive values', () => {
    expect(resolveOutputTokenLimit(0)).toBeUndefined()
    expect(resolveOutputTokenLimit(-1)).toBeUndefined()
    expect(resolveOutputTokenLimit(-100)).toBeUndefined()
  })

  it('returns undefined for nullish / non-finite inputs', () => {
    expect(resolveOutputTokenLimit(undefined)).toBeUndefined()
    expect(resolveOutputTokenLimit(null)).toBeUndefined()
    expect(resolveOutputTokenLimit(NaN)).toBeUndefined()
    expect(resolveOutputTokenLimit(Infinity)).toBeUndefined()
    expect(resolveOutputTokenLimit(-Infinity)).toBeUndefined()
  })
})

describe('isReasoningModelById', () => {
  it('classifies OpenAI o-family as reasoning', () => {
    expect(isReasoningModelById('o1')).toBe(true)
    expect(isReasoningModelById('o1-mini')).toBe(true)
    expect(isReasoningModelById('o3')).toBe(true)
    expect(isReasoningModelById('o3-mini')).toBe(true)
    expect(isReasoningModelById('o4-mini')).toBe(true)
    expect(isReasoningModelById('o3-2024-12-17')).toBe(true)
  })

  it('classifies gpt-5-thinking variants as reasoning', () => {
    expect(isReasoningModelById('gpt-5-thinking')).toBe(true)
    expect(isReasoningModelById('gpt-5-reasoning')).toBe(true)
    expect(isReasoningModelById('gpt-5-thinking-2026-01-01')).toBe(true)
  })

  it('rejects the gpt-4o-1 false-positive trap', () => {
    // A naive startsWith('o') check would trap "gpt-4o-1". The detector must
    // require the family prefix to end on a token boundary.
    expect(isReasoningModelById('gpt-4o-1')).toBe(false)
    expect(isReasoningModelById('gpt-4o')).toBe(false)
    expect(isReasoningModelById('gpt-4o-mini')).toBe(false)
  })

  it('rejects non-OpenAI providers and standard models', () => {
    expect(isReasoningModelById('claude-sonnet-4-6')).toBe(false)
    expect(isReasoningModelById('deepseek-chat')).toBe(false)
    expect(isReasoningModelById('glm-4')).toBe(false)
  })

  it('handles edge cases safely', () => {
    expect(isReasoningModelById(undefined)).toBe(false)
    expect(isReasoningModelById(null)).toBe(false)
    expect(isReasoningModelById('')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(isReasoningModelById('O3-MINI')).toBe(true)
    expect(isReasoningModelById('GPT-5-Thinking')).toBe(true)
  })
})
