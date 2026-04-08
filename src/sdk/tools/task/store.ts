/**
 * @module tools/task/store
 * In-memory task store shared across task tools.
 * @license MIT
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'deleted'
  | 'running'
  | 'failed';

export interface Task {
  id: string;
  subject: string;
  description: string;
  status: TaskStatus;
  owner: string | null;
  /** IDs of tasks this task blocks. */
  blocks: string[];
  /** IDs of tasks that must complete before this task can start. */
  blockedBy: string[];
  metadata: Record<string, unknown> | null;
  output: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Global store
// ---------------------------------------------------------------------------

/** Global task store shared across all tool invocations. */
export const taskStore = new Map<string, Task>();

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

export function taskToSummary(task: Task): Record<string, unknown> {
  return {
    id: task.id,
    subject: task.subject,
    status: task.status,
    owner: task.owner,
    blocked_by: task.blockedBy,
  };
}

export function taskToFull(task: Task): Record<string, unknown> {
  return {
    id: task.id,
    subject: task.subject,
    description: task.description,
    status: task.status,
    owner: task.owner,
    blocks: task.blocks,
    blocked_by: task.blockedBy,
    metadata: task.metadata,
    output: task.output,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
  };
}
