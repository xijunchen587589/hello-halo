/**
 * @module tools/send-message/schema
 * SendMessage tool schema and configuration.
 * @license MIT
 */

export const SEND_MESSAGE_TOOL_NAME = 'SendMessage';

export const SEND_MESSAGE_TOOL_DESCRIPTION =
  'Send a message to another agent by name, or broadcast to all active agents with to="*". ' +
  'Recipients accumulate messages in their inbox and can retrieve them. ' +
  'Use this for coordination between concurrent sub-agents.';

export const SEND_MESSAGE_TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    to: {
      type: 'string',
      description:
        'Recipient agent name or session ID. Use "*" to broadcast to all.',
    },
    message: {
      type: 'string',
      description: 'Message content',
    },
    summary: {
      type: 'string',
      description: '5-10 word preview for the UI (optional)',
    },
  },
  required: ['to', 'message'],
} as const;
