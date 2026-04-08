/**
 * @module tools/todo-write
 * TodoWriteTool — write and manage a todo/task list.
 * @license MIT
 */

import type { Tool, ToolContext, ToolResult } from '../../types/tool.js';
import { toolSuccess, toolError } from '../../types/tool.js';
import {
  TODO_WRITE_TOOL_NAME,
  TODO_WRITE_TOOL_DESCRIPTION,
  TODO_WRITE_TOOL_INPUT_SCHEMA,
} from './schema.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TodoStatus = 'pending' | 'in_progress' | 'completed';

interface TodoItem {
  content: string;
  status: TodoStatus;
  activeForm: string;
}

// ---------------------------------------------------------------------------
// In-memory store (per session)
// ---------------------------------------------------------------------------

const todoStore = new Map<string, TodoItem[]>();

/** Get the stored todos for a session. */
export function getTodos(sessionId: string): TodoItem[] {
  return todoStore.get(sessionId) ?? [];
}

// ---------------------------------------------------------------------------
// Status transition validation
// ---------------------------------------------------------------------------

const VALID_STATUSES = new Set<string>(['pending', 'in_progress', 'completed']);

function validateTransition(
  content: string,
  oldStatus: TodoStatus,
  newStatus: TodoStatus,
): string | null {
  if (oldStatus === newStatus) return null;

  // Completed tasks should not regress
  if (oldStatus === 'completed' && newStatus !== 'completed') {
    return `Task "${content}": cannot change status of a completed task (currently "completed" → "${newStatus}").`;
  }
  // Cannot move in_progress backwards to pending
  if (oldStatus === 'in_progress' && newStatus === 'pending') {
    return `Task "${content}": cannot move status backwards ("in_progress" → "pending").`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// TodoWriteTool
// ---------------------------------------------------------------------------

export const TodoWriteTool: Tool = {
  name: TODO_WRITE_TOOL_NAME,
  description: TODO_WRITE_TOOL_DESCRIPTION,
  inputSchema: TODO_WRITE_TOOL_INPUT_SCHEMA as unknown as Record<string, unknown>,
  permissionLevel: 'none',

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const rawTodos = input.todos;
    if (!Array.isArray(rawTodos)) {
      return toolError('Missing required parameter: todos (must be an array)');
    }

    // Parse and validate
    const todos: TodoItem[] = [];
    for (const item of rawTodos) {
      const obj = item as Record<string, unknown>;
      const content = obj.content as string;
      const status = obj.status as string;
      const activeForm = obj.activeForm as string;

      if (!content || !status) {
        return toolError('Each todo must have content and status fields.');
      }
      if (!VALID_STATUSES.has(status)) {
        return toolError(
          `Invalid status "${status}": must be one of "pending", "in_progress", or "completed".`,
        );
      }

      todos.push({
        content,
        status: status as TodoStatus,
        activeForm: activeForm || content,
      });
    }

    // Load existing state for transition validation (keyed by content)
    const existing = new Map<string, TodoStatus>();
    for (const item of getTodos(ctx.sessionId)) {
      existing.set(item.content, item.status);
    }

    // Validate transitions
    for (const item of todos) {
      const oldStatus = existing.get(item.content);
      if (oldStatus) {
        const err = validateTransition(item.content, oldStatus, item.status);
        if (err) return toolError(err);
      }
    }

    // Counts
    const total = todos.length;
    const completed = todos.filter((t) => t.status === 'completed').length;
    const inProgress = todos.filter((t) => t.status === 'in_progress').length;
    const pending = total - completed - inProgress;

    // Build output
    let output = `Todo list updated (${total} total: ${pending} pending, ${inProgress} in progress, ${completed} completed)\n\n`;

    for (const item of todos) {
      const icon =
        item.status === 'pending'
          ? '[ ]'
          : item.status === 'in_progress'
            ? '[~]'
            : '[x]';
      output += `${icon} ${item.status === 'in_progress' ? item.activeForm : item.content}\n`;
    }

    // Persist to in-memory store
    todoStore.set(ctx.sessionId, [...todos]);

    // Completion messages
    if (total === 0 || (pending === 0 && inProgress === 0)) {
      if (total > 0) {
        output +=
          '\n\nAll tasks completed! Great work — the session todo list is fully done.';
      }
    } else {
      if (inProgress > 0) {
        output += `\n\nReminder: ${inProgress} task${inProgress === 1 ? '' : 's'} are in_progress — complete them before marking the session done.`;
      }
      const incomplete = pending + inProgress;
      output += `\n\nWARNING: ${incomplete} task${incomplete === 1 ? ' is' : 's are'} still incomplete. Continue working on them.`;
    }

    return toolSuccess(output, {
      total,
      completed,
      in_progress: inProgress,
      pending,
    });
  },
};
