/**
 * @module prompt/constants
 * Prompt-related constants for the Agent-Core SDK.
 * @license MIT
 */

// ---------------------------------------------------------------------------
// System prompt boundary
// ---------------------------------------------------------------------------

/** Marker that splits cacheable vs dynamic sections of the system prompt. */
export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY = '__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__';

// ---------------------------------------------------------------------------
// Model defaults
// ---------------------------------------------------------------------------

export const DEFAULT_MODEL = 'claude-sonnet-4-6';
export const DEFAULT_MAX_TOKENS = 16384;
export const MAX_TURNS_DEFAULT = 100;

// ---------------------------------------------------------------------------
// Token / size limits
// ---------------------------------------------------------------------------

export const DEFAULT_MAX_RESULT_SIZE_CHARS = 50_000;
export const MAX_TOOL_RESULT_TOKENS = 100_000;
export const MAX_TOOL_RESULTS_PER_MESSAGE_CHARS = 200_000;

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

export const COMPLETION_THRESHOLD = 0.9;
export const DIMINISHING_THRESHOLD = 500;
export const DEFAULT_TOOL_RESULT_BUDGET = 50_000;

// ---------------------------------------------------------------------------
// Compact thresholds
// ---------------------------------------------------------------------------

export const AUTO_COMPACT_THRESHOLD = 0.9;
export const MAX_INPUT_TOKENS = 180_000;
export const TARGET_INPUT_TOKENS = 40_000;
export const KEEP_RECENT_MESSAGES = 10;
export const MAX_CONSECUTIVE_COMPACT_FAILURES = 3;

// ---------------------------------------------------------------------------
// Bash tool defaults
// ---------------------------------------------------------------------------

export const DEFAULT_TIMEOUT_MS = 120_000;
export const MAX_TIMEOUT_MS = 600_000;
export const MAX_OUTPUT_LEN = 100_000;

// ---------------------------------------------------------------------------
// Image / document limits
// ---------------------------------------------------------------------------

export const IMAGE_MAX_WIDTH = 2000;
export const IMAGE_MAX_HEIGHT = 2000;
export const API_IMAGE_MAX_BASE64_SIZE = 5 * 1024 * 1024;
export const PDF_TARGET_RAW_SIZE = 20 * 1024 * 1024;
export const API_PDF_MAX_PAGES = 100;

// ---------------------------------------------------------------------------
// Context window sizes
// ---------------------------------------------------------------------------

/** Return the approximate context window size for a model. */
export function contextWindowForModel(model: string): number {
  const lower = model.toLowerCase();
  if (
    lower.includes('opus-4') ||
    lower.includes('sonnet-4') ||
    lower.includes('haiku-4') ||
    lower.includes('claude-3-5') ||
    lower.includes('claude-3.5')
  ) {
    return 200_000;
  }
  return 100_000;
}

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

export const MAX_TOKENS_RECOVERY_LIMIT = 3;
export const MAX_TOKENS_RECOVERY_MSG =
  'Output token limit hit. Resume directly — no apology, no recap of what ' +
  'you were doing. Pick up mid-thought if that is where the cut happened. ' +
  'Break remaining work into smaller pieces.';
