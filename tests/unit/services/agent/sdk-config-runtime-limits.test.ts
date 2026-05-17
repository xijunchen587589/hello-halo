/**
 * Unit tests for sdk-config.resolveSdkRuntimeLimits — the pure resolver that
 * turns Halo's resolved model capabilities into CC subprocess env values.
 *
 * Production scenario this guards against:
 *   - Issue #112: chat / digital humans hit "response exceeded 32000 output
 *     token maximum" because CC's default max_tokens was never overridden by
 *     the user-configured ModelConfigPanel values.
 *   - The Model Config UI (contextWindow + maxOutputTokens) had no consumer
 *     on the agent side; this resolver is the single point that maps it onto
 *     CC's CLAUDE_CODE_MAX_OUTPUT_TOKENS / CLAUDE_CODE_AUTO_COMPACT_WINDOW.
 *
 * Clamp lower bounds matter operationally:
 *   - maxOutputTokens < 20_000 truncates CC's own compact summary call
 *     (p99.99 ≈ 17_387 tokens per CC source).
 *   - contextWindow < 40_000 pushes the autoCompactThreshold negative and
 *     causes compaction to fire every turn.
 */

import { describe, expect, it } from 'vitest'
import { resolveSdkRuntimeLimits } from '../../../../src/main/services/agent/sdk-config'

describe('resolveSdkRuntimeLimits', () => {
  it('returns empty object when capabilities are undefined', () => {
    expect(resolveSdkRuntimeLimits(undefined)).toEqual({})
  })

  it('passes through values inside the safe range', () => {
    expect(
      resolveSdkRuntimeLimits({ maxOutputTokens: 64_000, contextWindow: 200_000 })
    ).toEqual({ maxOutputTokens: 64_000, autoCompactWindow: 200_000 })
  })

  it('clamps maxOutputTokens up to MAX_OUTPUT_TOKENS_MIN to protect compact summary', () => {
    // 8192 would truncate CC's compact summary mid-generation.
    expect(
      resolveSdkRuntimeLimits({ maxOutputTokens: 8_192, contextWindow: 200_000 })
    ).toMatchObject({ maxOutputTokens: 20_000 })
  })

  it('clamps contextWindow up to CONTEXT_WINDOW_MIN to keep autoCompactThreshold positive', () => {
    // A 32K window would make autoCompactThreshold negative once the
    // 20K summary reserve + 13K compact buffer is subtracted.
    expect(
      resolveSdkRuntimeLimits({ maxOutputTokens: 64_000, contextWindow: 32_768 })
    ).toMatchObject({ autoCompactWindow: 40_000 })
  })

  it('caps maxOutputTokens at MAX_OUTPUT_TOKENS_MAX (1M)', () => {
    expect(
      resolveSdkRuntimeLimits({ maxOutputTokens: 5_000_000, contextWindow: 200_000 })
    ).toMatchObject({ maxOutputTokens: 1_000_000 })
  })

  it('caps contextWindow at CONTEXT_WINDOW_MAX (2M)', () => {
    expect(
      resolveSdkRuntimeLimits({ maxOutputTokens: 64_000, contextWindow: 10_000_000 })
    ).toMatchObject({ autoCompactWindow: 2_000_000 })
  })

  it('rounds fractional inputs to integers', () => {
    expect(
      resolveSdkRuntimeLimits({ maxOutputTokens: 64_000.7, contextWindow: 200_000.3 })
    ).toEqual({ maxOutputTokens: 64_001, autoCompactWindow: 200_000 })
  })

  it('omits maxOutputTokens when the value is not a positive finite number', () => {
    expect(
      resolveSdkRuntimeLimits({ maxOutputTokens: 0, contextWindow: 200_000 })
    ).toEqual({ autoCompactWindow: 200_000 })
    expect(
      resolveSdkRuntimeLimits({ maxOutputTokens: Number.NaN, contextWindow: 200_000 })
    ).toEqual({ autoCompactWindow: 200_000 })
  })

  it('omits autoCompactWindow when the value is not a positive finite number', () => {
    expect(
      resolveSdkRuntimeLimits({ maxOutputTokens: 64_000, contextWindow: 0 })
    ).toEqual({ maxOutputTokens: 64_000 })
    expect(
      resolveSdkRuntimeLimits({ maxOutputTokens: 64_000, contextWindow: Number.NaN })
    ).toEqual({ maxOutputTokens: 64_000 })
  })

  it('matches Claude Sonnet 4.6 preset (200K context, 64K output)', () => {
    // Mirrors model-capabilities.json claude-sonnet- pattern.
    expect(
      resolveSdkRuntimeLimits({ maxOutputTokens: 64_000, contextWindow: 200_000 })
    ).toEqual({ maxOutputTokens: 64_000, autoCompactWindow: 200_000 })
  })

  it('matches DeepSeek-Chat preset (131K context) without forcing a too-low cap on output', () => {
    expect(
      resolveSdkRuntimeLimits({ maxOutputTokens: 64_000, contextWindow: 131_072 })
    ).toEqual({ maxOutputTokens: 64_000, autoCompactWindow: 131_072 })
  })
})
