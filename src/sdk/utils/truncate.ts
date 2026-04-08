/**
 * @module utils/truncate
 * Content truncation utilities for tool results and general text.
 * @license MIT
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default maximum characters for a single tool result. */
export const DEFAULT_MAX_RESULT_SIZE_CHARS = 50_000;

/** Maximum token budget for tool results (approximately 400KB of text). */
export const MAX_TOOL_RESULT_TOKENS = 100_000;

/** Maximum total characters across all tool results in a single message. */
export const MAX_TOOL_RESULTS_PER_MESSAGE_CHARS = 200_000;

// ---------------------------------------------------------------------------
// Truncation
// ---------------------------------------------------------------------------

/**
 * Truncate content to a maximum character count.
 * When truncated, inserts a marker in the middle indicating how much was removed.
 *
 * @param content - The text content to truncate
 * @param maxChars - Maximum number of characters to keep
 * @returns The (potentially truncated) content
 */
export function truncateContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) {
    return content;
  }

  // Keep equal parts from the start and end, insert a truncation marker
  const omitted = content.length - maxChars;
  const halfBudget = Math.floor(maxChars / 2);
  const head = content.slice(0, halfBudget);
  const tail = content.slice(content.length - halfBudget);
  const marker = `\n\n[Content truncated: ${omitted} chars omitted]\n\n`;

  return head + marker + tail;
}

/**
 * Truncate a tool result to fit within the tool result budget.
 * Uses the same head/tail strategy as truncateContent.
 *
 * @param content - Tool result content to truncate
 * @param budget - Maximum characters (defaults to DEFAULT_MAX_RESULT_SIZE_CHARS)
 * @returns The (potentially truncated) content
 */
export function truncateToolResult(
  content: string,
  budget: number = DEFAULT_MAX_RESULT_SIZE_CHARS,
): string {
  return truncateContent(content, budget);
}
