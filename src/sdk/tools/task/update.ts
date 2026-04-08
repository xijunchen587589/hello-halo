/**
 * @module tools/task/update
 * TaskUpdateTool — update a task's properties.
 * @license MIT
 */

import type { Tool, ToolContext, ToolResult } from '../../types/tool.js';
import { toolSuccess, toolError } from '../../types/tool.js';
import {
  TASK_UPDATE_TOOL_NAME,
  TASK_UPDATE_DESCRIPTION,
  TASK_UPDATE_INPUT_SCHEMA,
} from './schema.js';
import { taskStore, type TaskStatus } from './store.js';

const VALID_STATUSES = new Set([
  'pending', 'in_progress', 'completed', 'deleted', 'running', 'failed',
]);

export const TaskUpdateTool: Tool = {
  name: TASK_UPDATE_TOOL_NAME,
  description: TASK_UPDATE_DESCRIPTION,
  inputSchema: TASK_UPDATE_INPUT_SCHEMA as unknown as Record<string, unknown>,
  permissionLevel: 'none',

  async execute(
    input: Record<string, unknown>,
    _ctx: ToolContext,
  ): Promise<ToolResult> {
    const taskId = (input.task_id ?? input.taskId) as string | undefined;
    if (!taskId) {
      return toolError('Missing required parameter: task_id');
    }

    const task = taskStore.get(taskId);
    if (!task) {
      return toolError(`Task '${taskId}' not found`);
    }

    const updatedFields: string[] = [];

    if (input.subject !== undefined) {
      task.subject = input.subject as string;
      updatedFields.push('subject');
    }
    if (input.description !== undefined) {
      task.description = input.description as string;
      updatedFields.push('description');
    }
    if (input.status !== undefined) {
      const status = input.status as string;
      if (!VALID_STATUSES.has(status)) {
        return toolError(`Unknown status: ${status}`);
      }
      task.status = (status === 'in-progress' ? 'in_progress' : status) as TaskStatus;
      updatedFields.push('status');
    }
    if (input.owner !== undefined) {
      task.owner = input.owner as string;
      updatedFields.push('owner');
    }
    if (input.addBlocks !== undefined) {
      for (const b of input.addBlocks as string[]) {
        if (!task.blocks.includes(b)) task.blocks.push(b);
      }
      updatedFields.push('blocks');
    }
    if (input.addBlockedBy !== undefined) {
      for (const b of input.addBlockedBy as string[]) {
        if (!task.blockedBy.includes(b)) task.blockedBy.push(b);
      }
      updatedFields.push('blocked_by');
    }
    if (input.metadata !== undefined) {
      task.metadata = input.metadata as Record<string, unknown>;
      updatedFields.push('metadata');
    }
    if (input.output !== undefined) {
      task.output = input.output as string;
      updatedFields.push('output');
    }

    task.updatedAt = new Date().toISOString();

    // Handle deletion
    if (task.status === 'deleted') {
      taskStore.delete(taskId);
    }

    return toolSuccess(
      JSON.stringify(
        { success: true, task_id: taskId, updated_fields: updatedFields },
        null,
        2,
      ),
    );
  },
};
