/**
 * @module tools/plan-mode/schema
 * EnterPlanMode / ExitPlanMode tool schemas.
 * @license MIT
 */

// ---------------------------------------------------------------------------
// EnterPlanMode
// ---------------------------------------------------------------------------

export const ENTER_PLAN_MODE_TOOL_NAME = 'EnterPlanMode';

export const ENTER_PLAN_MODE_DESCRIPTION =
  'Enter plan mode. In plan mode, the assistant can only read files and ' +
  'think, but cannot execute commands or write files. Use this to step back ' +
  'and plan a complex change before implementing it.';

export const ENTER_PLAN_MODE_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    reason: {
      type: 'string',
      description: 'Why you want to enter plan mode',
    },
  },
  required: [],
} as const;

// ---------------------------------------------------------------------------
// ExitPlanMode
// ---------------------------------------------------------------------------

export const EXIT_PLAN_MODE_TOOL_NAME = 'ExitPlanMode';

export const EXIT_PLAN_MODE_DESCRIPTION =
  'Exit plan mode and return to normal execution mode where all tools ' +
  'are available. Optionally provide a summary of the plan.';

export const EXIT_PLAN_MODE_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: 'Summary of the plan you developed',
    },
  },
  required: [],
} as const;
