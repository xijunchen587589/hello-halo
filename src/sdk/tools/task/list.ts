/**
 * @module tools/task/list
 * TaskListTool, TaskGetTool, TaskStopTool, TaskOutputTool.
 * @license MIT
 */

import type { Tool, ToolContext, ToolResult } from '../../types/tool.js';
import { toolSuccess, toolError } from '../../types/tool.js';
import {
  TASK_LIST_TOOL_NAME,
  TASK_LIST_DESCRIPTION,
  TASK_LIST_INPUT_SCHEMA,
  TASK_GET_TOOL_NAME,
  TASK_GET_DESCRIPTION,
  TASK_GET_INPUT_SCHEMA,
  TASK_STOP_TOOL_NAME,
  TASK_STOP_DESCRIPTION,
  TASK_STOP_INPUT_SCHEMA,
  TASK_OUTPUT_TOOL_NAME,
  TASK_OUTPUT_DESCRIPTION,
  TASK_OUTPUT_INPUT_SCHEMA,
} from './schema.js';
import { taskStore, taskToSummary, taskToFull } from './store.js';

// ---------------------------------------------------------------------------
// TaskListTool
// ---------------------------------------------------------------------------

export const TaskListTool: Tool = {
  name: TASK_LIST_TOOL_NAME,
  description: TASK_LIST_DESCRIPTION,
  inputSchema: TASK_LIST_INPUT_SCHEMA as unknown as Record<string, unknown>,
  permissionLevel: 'none',

  async execute(
    input: Record<string, unknown>,
    _ctx: ToolContext,
  ): Promise<ToolResult> {
    const includeCompleted = input.include_completed === true;

    const tasks = Array.from(taskStore.values())
      .filter((task) => {
        if (task.status === 'deleted') return false;
        if (task.status === 'completed') return includeCompleted;
        return true;
      })
      .map(taskToSummary);

    return toolSuccess(JSON.stringify(tasks, null, 2));
  },
};

// ---------------------------------------------------------------------------
// TaskGetTool
// ---------------------------------------------------------------------------

export const TaskGetTool: Tool = {
  name: TASK_GET_TOOL_NAME,
  description: TASK_GET_DESCRIPTION,
  inputSchema: TASK_GET_INPUT_SCHEMA as unknown as Record<string, unknown>,
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
      return toolSuccess(JSON.stringify(null, null, 2));
    }

    return toolSuccess(JSON.stringify(taskToFull(task), null, 2));
  },
};

// ---------------------------------------------------------------------------
// TaskStopTool
// ---------------------------------------------------------------------------

export const TaskStopTool: Tool = {
  name: TASK_STOP_TOOL_NAME,
  description: TASK_STOP_DESCRIPTION,
  inputSchema: TASK_STOP_INPUT_SCHEMA as unknown as Record<string, unknown>,
  permissionLevel: 'execute',

  async execute(
    input: Record<string, unknown>,
    _ctx: ToolContext,
  ): Promise<ToolResult> {
    const taskId = (input.task_id ?? input.shell_id) as string | undefined;
    if (!taskId) {
      return toolError('Missing required parameter: task_id');
    }

    const task = taskStore.get(taskId);
    if (!task) {
      return toolError(`Task '${taskId}' not found`);
    }

    if (task.status !== 'running' && task.status !== 'in_progress') {
      return toolError(
        `Task '${taskId}' is not running (status: ${task.status})`,
      );
    }

    task.status = 'completed';
    task.updatedAt = new Date().toISOString();

    return toolSuccess(
      JSON.stringify({ message: 'Task stopped', task_id: taskId }, null, 2),
    );
  },
};

// ---------------------------------------------------------------------------
// TaskOutputTool
// ---------------------------------------------------------------------------

export const TaskOutputTool: Tool = {
  name: TASK_OUTPUT_TOOL_NAME,
  description: TASK_OUTPUT_DESCRIPTION,
  inputSchema: TASK_OUTPUT_INPUT_SCHEMA as unknown as Record<string, unknown>,
  permissionLevel: 'none',

  async execute(
    input: Record<string, unknown>,
    _ctx: ToolContext,
  ): Promise<ToolResult> {
    const taskId = input.task_id as string | undefined;
    if (!taskId) {
      return toolError('Missing required parameter: task_id');
    }

    const task = taskStore.get(taskId);
    if (!task) {
      return toolError(`Task '${taskId}' not found`);
    }

    const block = input.block !== false; // default true
    let retrievalStatus: string;

    if (task.status === 'completed' || task.status === 'failed') {
      retrievalStatus = 'success';
    } else if (task.status === 'running' || task.status === 'in_progress') {
      retrievalStatus = block ? 'success' : 'not_ready';
    } else {
      retrievalStatus = 'success';
    }

    return toolSuccess(
      JSON.stringify(
        { retrieval_status: retrievalStatus, task: taskToFull(task) },
        null,
        2,
      ),
    );
  },
};
