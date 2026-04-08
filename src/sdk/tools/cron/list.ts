/**
 * @module tools/cron/list
 * CronListTool — List all scheduled cron tasks.
 * @license MIT
 */

import type { Tool, ToolContext, ToolResult } from '../../types/tool.js';
import { toolSuccess } from '../../types/tool.js';
import {
  CRON_LIST_TOOL_NAME,
  CRON_LIST_TOOL_DESCRIPTION,
  CRON_LIST_INPUT_SCHEMA,
} from './schema.js';
import { cronStore, cronToHuman } from './store.js';

export const CronListTool: Tool = {
  name: CRON_LIST_TOOL_NAME,
  description: CRON_LIST_TOOL_DESCRIPTION,
  inputSchema: CRON_LIST_INPUT_SCHEMA,
  permissionLevel: 'readonly',

  async execute(
    _input: Record<string, unknown>,
    _ctx: ToolContext,
  ): Promise<ToolResult> {
    await cronStore.ensureLoaded();

    const tasks = cronStore.getAll();

    if (tasks.length === 0) {
      return toolSuccess('No scheduled cron tasks.');
    }

    // Sort by creation time
    tasks.sort((a, b) => a.createdAt - b.createdAt);

    const lines = tasks.map((t) => {
      const promptPreview =
        t.prompt.length > 60 ? t.prompt.slice(0, 60) + '...' : t.prompt;
      return `${t.id} | ${t.cron} | ${cronToHuman(t.cron)} | recurring=${t.recurring} | durable=${t.durable} | prompt: ${promptPreview}`;
    });

    return toolSuccess(
      `Scheduled tasks (${tasks.length}):\n\n${lines.join('\n')}`,
    );
  },
};
