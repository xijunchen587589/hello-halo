/**
 * @module tools/plan-mode/exit
 * ExitPlanModeTool — leave planning mode and return to normal execution.
 * @license MIT
 */

import type { Tool, ToolContext, ToolResult } from '../../types/tool.js';
import { toolSuccess } from '../../types/tool.js';
import {
  EXIT_PLAN_MODE_TOOL_NAME,
  EXIT_PLAN_MODE_DESCRIPTION,
  EXIT_PLAN_MODE_INPUT_SCHEMA,
} from './schema.js';

export const ExitPlanModeTool: Tool = {
  name: EXIT_PLAN_MODE_TOOL_NAME,
  description: EXIT_PLAN_MODE_DESCRIPTION,
  inputSchema: EXIT_PLAN_MODE_INPUT_SCHEMA as unknown as Record<string, unknown>,
  permissionLevel: 'none',

  async execute(
    input: Record<string, unknown>,
    _ctx: ToolContext,
  ): Promise<ToolResult> {
    const summary = input.summary as string | undefined;

    const msg = summary
      ? `Exited plan mode. Plan summary: ${summary}`
      : 'Exited plan mode. All tools are now available.';

    return toolSuccess(msg, {
      type: 'exit_plan_mode',
      summary: summary ?? null,
    });
  },
};
