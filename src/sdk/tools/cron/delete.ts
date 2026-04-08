/**
 * @module tools/cron/delete
 * CronDeleteTool — Cancel a scheduled cron task by ID.
 * @license MIT
 */

import type { Tool, ToolContext, ToolResult } from '../../types/tool.js';
import { toolSuccess, toolError } from '../../types/tool.js';
import {
  CRON_DELETE_TOOL_NAME,
  CRON_DELETE_TOOL_DESCRIPTION,
  CRON_DELETE_INPUT_SCHEMA,
} from './schema.js';
import { cronStore, persistTasksToDisk } from './store.js';

export const CronDeleteTool: Tool = {
  name: CRON_DELETE_TOOL_NAME,
  description: CRON_DELETE_TOOL_DESCRIPTION,
  inputSchema: CRON_DELETE_INPUT_SCHEMA,
  permissionLevel: 'write',

  async execute(
    input: Record<string, unknown>,
    _ctx: ToolContext,
  ): Promise<ToolResult> {
    const id = input.id as string | undefined;
    if (!id || typeof id !== 'string') {
      return toolError('Missing required parameter: id');
    }

    await cronStore.ensureLoaded();

    const removed = cronStore.remove(id);
    if (!removed) {
      return toolError(`Cron task '${id}' not found.`);
    }

    // If the removed task was durable, update the persisted file
    if (removed.durable) {
      await persistTasksToDisk();
    }

    return toolSuccess(`Deleted cron task '${id}'.`);
  },
};
