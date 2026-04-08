/**
 * @module tools/task/create
 * TaskCreateTool — create a new task to track work items.
 * @license MIT
 */

import type { Tool, ToolContext, ToolResult } from '../../types/tool.js';
import { toolSuccess, toolError } from '../../types/tool.js';
import {
  TASK_CREATE_TOOL_NAME,
  TASK_CREATE_DESCRIPTION,
  TASK_CREATE_INPUT_SCHEMA,
} from './schema.js';
import { taskStore, type Task } from './store.js';

export const TaskCreateTool: Tool = {
  name: TASK_CREATE_TOOL_NAME,
  description: TASK_CREATE_DESCRIPTION,
  inputSchema: TASK_CREATE_INPUT_SCHEMA as unknown as Record<string, unknown>,
  permissionLevel: 'none',

  async execute(
    input: Record<string, unknown>,
    _ctx: ToolContext,
  ): Promise<ToolResult> {
    const subject = input.subject as string | undefined;
    const description = input.description as string | undefined;

    if (!subject || typeof subject !== 'string') {
      return toolError('Missing required parameter: subject');
    }
    if (!description || typeof description !== 'string') {
      return toolError('Missing required parameter: description');
    }

    const now = new Date().toISOString();
    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const task: Task = {
      id: taskId,
      subject,
      description,
      status: 'pending',
      owner: null,
      blocks: [],
      blockedBy: [],
      metadata: (input.metadata as Record<string, unknown>) ?? null,
      output: null,
      createdAt: now,
      updatedAt: now,
    };

    taskStore.set(taskId, task);

    return toolSuccess(
      JSON.stringify({ task_id: taskId, subject }, null, 2),
    );
  },
};
