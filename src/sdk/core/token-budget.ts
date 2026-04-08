/**
 * @module core/token-budget
 * Token budget tracking and auto-continuation logic.
 * @license MIT
 */

import type { Message } from '../types/provider.js';
import { estimateMessageTokens } from '../utils/tokens.js';
import {
  AUTO_COMPACT_THRESHOLD,
  contextWindowForModel,
} from '../prompt/constants.js';

// ---------------------------------------------------------------------------
// TokenBudget
// ---------------------------------------------------------------------------

/**
 * Tracks token usage relative to the model's context window.
 * Used to decide when to trigger compaction and when to reduce tool results.
 */
export class TokenBudget {
  /** Total context window size in tokens. */
  readonly contextWindow: number;
  /** Maximum output tokens per response. */
  readonly maxOutputTokens: number;

  private _lastKnownInputTokens = 0;

  constructor(model: string, maxOutputTokens = 16384) {
    this.contextWindow = contextWindowForModel(model);
    this.maxOutputTokens = maxOutputTokens;
  }

  /**
   * Update the last known input token count from API usage data.
   * This is more accurate than local estimation.
   */
  updateFromUsage(inputTokens: number): void {
    this._lastKnownInputTokens = inputTokens;
  }

  /**
   * Estimate current input tokens from the message history.
   * Falls back to the heuristic estimator if no API usage data is available.
   */
  currentInputTokens(messages: Message[]): number {
    if (this._lastKnownInputTokens > 0) {
      return this._lastKnownInputTokens;
    }
    return estimateMessageTokens(messages);
  }

  /** Remaining input tokens before hitting the context window. */
  remainingInputTokens(messages: Message[]): number {
    const used = this.currentInputTokens(messages);
    const available = this.contextWindow - this.maxOutputTokens;
    return Math.max(0, available - used);
  }

  /**
   * Usage ratio: 0.0 = empty, 1.0 = full.
   * Based on input tokens relative to the available input budget
   * (context window minus output token reservation).
   */
  usageRatio(messages: Message[]): number {
    const used = this.currentInputTokens(messages);
    const available = this.contextWindow - this.maxOutputTokens;
    if (available <= 0) return 1.0;
    return Math.min(1.0, used / available);
  }

  /**
   * Whether auto-compact should be triggered.
   * Returns true when usage exceeds AUTO_COMPACT_THRESHOLD (90%).
   */
  shouldCompact(messages: Message[]): boolean {
    return this.usageRatio(messages) >= AUTO_COMPACT_THRESHOLD;
  }

  /**
   * Whether tool results should be proactively reduced/truncated.
   * Returns true when usage exceeds 70%.
   */
  shouldReduceToolResults(messages: Message[]): boolean {
    return this.usageRatio(messages) >= 0.7;
  }

  /** Human-readable summary of current budget status. */
  summary(messages: Message[]): string {
    const used = this.currentInputTokens(messages);
    const pct = (this.usageRatio(messages) * 100).toFixed(1);
    return `${used.toLocaleString()} / ${this.contextWindow.toLocaleString()} tokens (${pct}%)`;
  }
}
