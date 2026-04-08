/**
 * @module tools/plan-mode/enter
 * EnterPlanModeTool — switch the session into planning (read-only) mode.
 * @license MIT
 */

import type { Tool, ToolContext, ToolResult } from '../../types/tool.js';
import { toolSuccess } from '../../types/tool.js';
import {
  ENTER_PLAN_MODE_TOOL_NAME,
  ENTER_PLAN_MODE_DESCRIPTION,
  ENTER_PLAN_MODE_INPUT_SCHEMA,
} from './schema.js';

export const EnterPlanModeTool: Tool = {
  name: ENTER_PLAN_MODE_TOOL_NAME,
  description: ENTER_PLAN_MODE_DESCRIPTION,
  inputSchema: ENTER_PLAN_MODE_INPUT_SCHEMA as unknown as Record<string, unknown>,
  permissionLevel: 'none',

  async execute(
    input: Record<string, unknown>,
    _ctx: ToolContext,
  ): Promise<ToolResult> {
    const reason = input.reason as string | undefined;

    const msg = reason
      ? `Entered plan mode: ${reason}`
      : 'Entered plan mode. Only read-only operations are allowed.';

    return toolSuccess(msg, {
      type: 'enter_plan_mode',
      reason: reason ?? null,
    });
  },
};
