/**
 * @module tools/todo-write/schema
 * TodoWrite tool schema and configuration.
 * @license MIT
 */

export const TODO_WRITE_TOOL_NAME = 'TodoWrite';

export const TODO_WRITE_TOOL_DESCRIPTION =
  'Write and manage a todo/task list. Provide the complete list of todos ' +
  'each time (this replaces the entire list). Use this to track progress ' +
  'on multi-step tasks.';

export const TODO_WRITE_TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    todos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'The imperative form describing what needs to be done',
          },
          status: {
            type: 'string',
            enum: ['pending', 'in_progress', 'completed'],
          },
          activeForm: {
            type: 'string',
            description: 'The present continuous form shown during execution',
          },
        },
        required: ['content', 'status', 'activeForm'],
      },
      description: 'The updated todo list',
    },
  },
  required: ['todos'],
} as const;
