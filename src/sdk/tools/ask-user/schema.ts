/**
 * @module tools/ask-user/schema
 * AskUserQuestion tool schema and configuration.
 * @license MIT
 */

export const ASK_USER_TOOL_NAME = 'AskUserQuestion';

export const ASK_USER_TOOL_DESCRIPTION =
  'Ask the user a question and wait for their response. Use this when you ' +
  'need clarification, confirmation, or additional information from the user. ' +
  'The question will be displayed and the user can type their answer.';

export const ASK_USER_TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    question: {
      type: 'string',
      description: 'The question to ask the user',
    },
    options: {
      type: 'array',
      items: { type: 'string' },
      description: 'Optional list of choices for multiple-choice questions',
    },
  },
  required: ['question'],
} as const;
