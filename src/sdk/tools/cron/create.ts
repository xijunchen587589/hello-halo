/**
 * @module tools/cron/create
 * CronCreateTool — Schedule a recurring or one-shot prompt.
 * @license MIT
 */

import { randomUUID } from 'node:crypto';
import type { Tool, ToolContext, ToolResult } from '../../types/tool.js';
import { toolSuccess, toolError } from '../../types/tool.js';
import {
  CRON_CREATE_TOOL_NAME,
  CRON_CREATE_TOOL_DESCRIPTION,
  CRON_CREATE_INPUT_SCHEMA,
} from './schema.js';
import { cronStore, type CronTask, validateCron, cronToHuman, persistTasksToDisk } from './store.js';

export const CronCreateTool: Tool = {
  name: CRON_CREATE_TOOL_NAME,
  description: CRON_CREATE_TOOL_DESCRIPTION,
  inputSchema: CRON_CREATE_INPUT_SCHEMA,
  permissionLevel: 'write',

  async execute(
    input: Record<string, unknown>,
    _ctx: ToolContext,
  ): Promise<ToolResult> {
    const cronExpr = input.cron as string | undefined;
    const prompt = input.prompt as string | undefined;

    if (!cronExpr || typeof cronExpr !== 'string') {
      return toolError('Missing required parameter: cron');
    }
    if (!prompt || typeof prompt !== 'string') {
      return toolError('Missing required parameter: prompt');
    }

    if (!validateCron(cronExpr)) {
      return toolError(
        `Invalid cron expression '${cronExpr}'. Expected 5 fields: M H DoM Mon DoW.`,
      );
    }

    const recurring = input.recurring !== false; // default true
    const durable = input.durable === true; // default false

    await cronStore.ensureLoaded();

    if (cronStore.size() >= 50) {
      return toolError('Too many scheduled jobs (max 50). Cancel one first.');
    }

    const id = randomUUID().slice(0, 8);
    const task: CronTask = {
      id,
      cron: cronExpr,
      prompt,
      recurring,
      durable,
      createdAt: Date.now(),
    };

    cronStore.set(id, task);

    if (durable) {
      await persistTasksToDisk();
    }

    const human = cronToHuman(cronExpr);
    const whereNote = durable
      ? 'Persisted to .claude/scheduled_tasks.json'
      : 'Session-only (dies when Claude exits)';

    const msg = recurring
      ? `Scheduled recurring job ${id} (${human}). ${whereNote}`
      : `Scheduled one-shot task ${id} (${human}). ${whereNote}. Will fire once then auto-delete.`;

    return toolSuccess(msg);
  },
};
