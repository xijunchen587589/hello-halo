/**
 * Unit tests for the OpenAI-compat request converters — stream_options injection.
 *
 * Scope (issue #181):
 *   - Chat Completions path injects `stream_options: { include_usage: true }`
 *     when the request has `stream: true`, and omits it otherwise.
 *   - Responses API path mirrors the Chat Completions behavior.
 *
 * OpenAI-compatible gateways (litellm, OpenAI public API) only return usage in
 * the final streamed chunk when `stream_options.include_usage` is set; without
 * it, `chunk.usage` is always empty and the UI's TokenUsageIndicator shows
 * zeros. These tests pin the contract at the protocol boundary.
 *
 * These tests live under the canonical `tests/unit/services/` path so they
 * match the project vitest config's recursive `tests/unit/` include pattern.
 */

import { describe, it, expect } from 'vitest'
import {
  convertAnthropicToOpenAIChat,
  convertAnthropicToOpenAIResponses
} from '../../../src/main/openai-compat-router/converters'
import type { AnthropicRequest } from '../../../src/main/openai-compat-router/types'

describe('Chat Completions — stream_options.include_usage (issue #181)', () => {
  it('injects stream_options.include_usage when stream is true', () => {
    // The OpenAI-compat gateway omits usage from streamed chunks unless the
    // request opts in. The converter must set stream_options.include_usage
    // so chunk.usage is populated downstream and the TokenUsageIndicator
    // renders real values instead of zeros.
    const request: AnthropicRequest = {
      model: 'gpt-4o',
      stream: true,
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello' }]
    }

    const result = convertAnthropicToOpenAIChat(request)

    expect(result.request.stream).toBe(true)
    expect(result.request.stream_options).toEqual({ include_usage: true })
  })

  it('omits stream_options when stream is false', () => {
    // Non-streaming responses carry usage in the top-level `usage` field, so
    // stream_options is unnecessary and must not be injected.
    const request: AnthropicRequest = {
      model: 'gpt-4o',
      stream: false,
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello' }]
    }

    const result = convertAnthropicToOpenAIChat(request)

    expect(result.request.stream).toBe(false)
    expect(result.request.stream_options).toBeUndefined()
  })

  it('omits stream_options when stream is not set (default falsy)', () => {
    // Anthropic's Request type marks `stream` as optional. When the caller
    // does not opt into streaming, the converter must not add stream_options.
    const request: AnthropicRequest = {
      model: 'gpt-4o',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello' }]
    }

    const result = convertAnthropicToOpenAIChat(request)

    expect(result.request.stream).toBeFalsy()
    expect(result.request.stream_options).toBeUndefined()
  })

  it('injects stream_options.include_usage for reasoning model requests', () => {
    // Sanity check: streaming and model id are orthogonal — the stream_options
    // contract must hold for reasoning models too, not just standard ones.
    const request: AnthropicRequest = {
      model: 'o1-mini',
      stream: true,
      max_tokens: 8192,
      messages: [{ role: 'user', content: 'Hello' }]
    }

    const result = convertAnthropicToOpenAIChat(request)

    expect(result.request.stream_options).toEqual({ include_usage: true })
  })
})

describe('Responses API — stream_options.include_usage (issue #181)', () => {
  it('injects stream_options.include_usage when stream is true', () => {
    // Defensive: the native OpenAI Responses API returns usage in
    // `response.completed` unconditionally, but translation-style gateways
    // (litellm and similar) gate usage on stream_options.include_usage.
    // See the converter comment for the full rationale.
    const request: AnthropicRequest = {
      model: 'claude-3-opus',
      stream: true,
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello!' }]
    }

    const result = convertAnthropicToOpenAIResponses(request)

    expect(result.request.stream).toBe(true)
    expect(result.request.stream_options).toEqual({ include_usage: true })
  })

  it('omits stream_options when stream is false', () => {
    const request: AnthropicRequest = {
      model: 'claude-3-opus',
      stream: false,
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello!' }]
    }

    const result = convertAnthropicToOpenAIResponses(request)

    expect(result.request.stream).toBe(false)
    expect(result.request.stream_options).toBeUndefined()
  })

  it('omits stream_options when stream is not set (default falsy)', () => {
    const request: AnthropicRequest = {
      model: 'claude-3-opus',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello!' }]
    }

    const result = convertAnthropicToOpenAIResponses(request)

    expect(result.request.stream).toBeFalsy()
    expect(result.request.stream_options).toBeUndefined()
  })

  it('injects stream_options.include_usage for reasoning model requests', () => {
    // Symmetry with the Chat Completions path: model id must not affect the
    // stream_options contract. Guards against future refactors that gate
    // stream_options on model family.
    const request: AnthropicRequest = {
      model: 'o1-mini',
      stream: true,
      max_tokens: 8192,
      messages: [{ role: 'user', content: 'Hello!' }]
    }

    const result = convertAnthropicToOpenAIResponses(request)

    expect(result.request.stream_options).toEqual({ include_usage: true })
  })
})
