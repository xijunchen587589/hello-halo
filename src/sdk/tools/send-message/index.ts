/**
 * @module tools/send-message
 * SendMessageTool — send a message to another agent or broadcast.
 *
 * This is a stub — actual message routing is done by the orchestrator.
 * Includes `setMessageRouter()` for the orchestrator to register the real handler.
 * @license MIT
 */

import type { Tool, ToolContext, ToolResult } from '../../types/tool.js';
import { toolSuccess, toolError } from '../../types/tool.js';
import {
  SEND_MESSAGE_TOOL_NAME,
  SEND_MESSAGE_TOOL_DESCRIPTION,
  SEND_MESSAGE_TOOL_INPUT_SCHEMA,
} from './schema.js';

// ---------------------------------------------------------------------------
// In-process inbox (simple implementation)
// ---------------------------------------------------------------------------

export interface AgentMessage {
  from: string;
  to: string;
  content: string;
  timestamp: number;
}

const inbox = new Map<string, AgentMessage[]>();

/** Remove and return all messages queued for `recipient`. */
export function drainInbox(recipient: string): AgentMessage[] {
  const messages = inbox.get(recipient) ?? [];
  inbox.delete(recipient);
  return messages;
}

/** Read (without removing) all messages queued for `recipient`. */
export function peekInbox(recipient: string): AgentMessage[] {
  return inbox.get(recipient) ?? [];
}

// ---------------------------------------------------------------------------
// Message router injection (set by orchestrator)
// ---------------------------------------------------------------------------

export type MessageRouter = (
  to: string,
  message: string,
  summary: string | undefined,
  ctx: ToolContext,
) => Promise<ToolResult>;

let _messageRouter: MessageRouter | null = null;

/**
 * Register the real message router. Called by the orchestrator.
 * Pass `null` to reset to default inbox mode.
 */
export function setMessageRouter(router: MessageRouter | null): void {
  _messageRouter = router;
}

// ---------------------------------------------------------------------------
// SendMessageTool
// ---------------------------------------------------------------------------

export const SendMessageTool: Tool = {
  name: SEND_MESSAGE_TOOL_NAME,
  description: SEND_MESSAGE_TOOL_DESCRIPTION,
  inputSchema: SEND_MESSAGE_TOOL_INPUT_SCHEMA as unknown as Record<string, unknown>,
  permissionLevel: 'none',

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const to = input.to as string | undefined;
    const message = input.message as string | undefined;
    const summary = input.summary as string | undefined;

    if (!to || typeof to !== 'string') {
      return toolError('Missing required parameter: to');
    }
    if (!message || typeof message !== 'string') {
      return toolError('Missing required parameter: message');
    }
    if (!message.trim()) {
      return toolError('Message cannot be empty.');
    }

    // If a real router is registered, use it
    if (_messageRouter) {
      return _messageRouter(to, message, summary, ctx);
    }

    // Default in-process inbox implementation
    const now = Math.floor(Date.now() / 1000);
    const msg: AgentMessage = {
      from: ctx.sessionId,
      to,
      content: message,
      timestamp: now,
    };

    const preview = summary ?? message.slice(0, 60);

    if (to === '*') {
      // Broadcast
      const recipients = Array.from(inbox.keys());
      if (recipients.length === 0) {
        return toolSuccess(
          'Broadcast queued (no active recipient inboxes yet).',
        );
      }
      for (const key of recipients) {
        const existing = inbox.get(key) ?? [];
        existing.push({ ...msg });
        inbox.set(key, existing);
      }
      return toolSuccess(
        `Broadcast to ${recipients.length} agent(s): ${preview}`,
      );
    }

    // Directed message
    const existing = inbox.get(to) ?? [];
    existing.push(msg);
    inbox.set(to, existing);

    return toolSuccess(`Message sent to '${to}': ${preview}`);
  },
};
