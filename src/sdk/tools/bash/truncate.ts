/**
 * @module tools/bash/truncate
 * Output truncation for bash command output.
 * @license MIT
 */

/** Maximum output length before truncation (characters). */
export const MAX_OUTPUT_LEN = 100_000;

/**
 * Truncate bash output if it exceeds MAX_OUTPUT_LEN.
 * Keeps the first half and last half, inserting a truncation notice in the middle.
 */
export function truncateBashOutput(output: string, maxLen: number = MAX_OUTPUT_LEN): string {
  if (output.length <= maxLen) {
    return output;
  }

  const half = Math.floor(maxLen / 2);
  const start = output.slice(0, half);
  const end = output.slice(output.length - half);
  const truncated = output.length - maxLen;

  return `${start}\n\n... (${truncated} characters truncated) ...\n\n${end}`;
}
