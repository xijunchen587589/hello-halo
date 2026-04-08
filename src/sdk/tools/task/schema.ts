/**
 * @module tools/task/schema
 * Task management tool schemas and configuration.
 * @license MIT
 */

// ---------------------------------------------------------------------------
// TaskCreate
// ---------------------------------------------------------------------------

export const TASK_CREATE_TOOL_NAME = 'TaskCreate';
export const TASK_CREATE_DESCRIPTION = 'Create a new task to track work items. Returns the task ID.';
export const TASK_CREATE_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    subject: { type: 'string', description: 'Brief title for the task' },
    description: { type: 'string', description: 'Detailed description of what needs to be done' },
    metadata: { type: 'object', description: 'Optional arbitrary metadata' },
  },
  required: ['subject', 'description'],
} as const;

// ---------------------------------------------------------------------------
// TaskGet
// ---------------------------------------------------------------------------

export const TASK_GET_TOOL_NAME = 'TaskGet';
export const TASK_GET_DESCRIPTION = 'Get full details of a task by ID.';
export const TASK_GET_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    task_id: { type: 'string', description: 'Task ID to retrieve' },
  },
  required: ['task_id'],
} as const;

// ---------------------------------------------------------------------------
// TaskUpdate
// ---------------------------------------------------------------------------

export const TASK_UPDATE_TOOL_NAME = 'TaskUpdate';
export const TASK_UPDATE_DESCRIPTION = "Update a task's properties (status, subject, description, etc.).";
export const TASK_UPDATE_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    task_id: { type: 'string', description: 'Task ID to update' },
    subject: { type: 'string' },
    description: { type: 'string' },
    status: {
      type: 'string',
      enum: ['pending', 'in_progress', 'completed', 'deleted', 'failed'],
    },
    owner: { type: 'string' },
    addBlocks: { type: 'array', items: { type: 'string' } },
    addBlockedBy: { type: 'array', items: { type: 'string' } },
    metadata: { type: 'object' },
    output: { type: 'string' },
  },
  required: ['task_id'],
} as const;

// ---------------------------------------------------------------------------
// TaskList
// ---------------------------------------------------------------------------

export const TASK_LIST_TOOL_NAME = 'TaskList';
export const TASK_LIST_DESCRIPTION = 'List all active tasks (excluding deleted/completed).';
export const TASK_LIST_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    include_completed: {
      type: 'boolean',
      description: 'Include completed tasks (default false)',
    },
  },
} as const;

// ---------------------------------------------------------------------------
// TaskStop
// ---------------------------------------------------------------------------

export const TASK_STOP_TOOL_NAME = 'TaskStop';
export const TASK_STOP_DESCRIPTION = 'Stop a running background task.';
export const TASK_STOP_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    task_id: { type: 'string', description: 'ID of the task to stop' },
  },
  required: ['task_id'],
} as const;

// ---------------------------------------------------------------------------
// TaskOutput
// ---------------------------------------------------------------------------

export const TASK_OUTPUT_TOOL_NAME = 'TaskOutput';
export const TASK_OUTPUT_DESCRIPTION = 'Get the output of a task.';
export const TASK_OUTPUT_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    task_id: { type: 'string', description: 'Task ID to get output for' },
    block: { type: 'boolean', description: 'Wait for task to complete (default true)' },
  },
  required: ['task_id'],
} as const;
