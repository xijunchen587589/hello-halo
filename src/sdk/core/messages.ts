/**
 * @module core/messages
 * Message construction and serialization utilities for the query loop.
 * @license MIT
 */

import type {
  Message,
  ContentBlock,
  ToolUseBlock,
  ToolResultBlock,
} from '../types/provider.js';
import { estimateTokens } from '../utils/tokens.js';

// ---------------------------------------------------------------------------
// Message builders
// ---------------------------------------------------------------------------

/**
 * Build a user message from text or structured content blocks.
 */
export function buildUserMessage(
  content: string | ContentBlock[],
): Message {
  return { role: 'user', content };
}

/**
 * Build a tool-result user message from an array of tool results.
 * Each result maps to a ToolResultBlock content block.
 */
export function buildToolResultMessage(
  results: Array<{
    toolUseId: string;
    content: string;
    isError: boolean;
  }>,
): Message {
  const blocks: ToolResultBlock[] = results.map((r) => ({
    type: 'tool_result' as const,
    tool_use_id: r.toolUseId,
    content: r.content,
    is_error: r.isError || undefined,
  }));

  return {
    role: 'user',
    content: blocks,
  };
}

// ---------------------------------------------------------------------------
// Block extraction
// ---------------------------------------------------------------------------

/**
 * Extract all tool_use blocks from an assistant message.
 * Returns an empty array if the message has no tool_use blocks.
 */
export function extractToolUseBlocks(message: Message): ToolUseBlock[] {
  if (typeof message.content === 'string') {
    return [];
  }
  return message.content.filter(
    (block): block is ToolUseBlock => block.type === 'tool_use',
  );
}

// ---------------------------------------------------------------------------
// Token estimation for messages
// ---------------------------------------------------------------------------

/**
 * Rough token estimate for a single message.
 * Uses the 4/3 chars ratio heuristic.
 */
export function messageTokenEstimate(message: Message): number {
  if (typeof message.content === 'string') {
    return estimateTokens(message.content) + 4; // +4 for role/structure overhead
  }

  let total = 4; // role/structure overhead
  for (const block of message.content) {
    total += contentBlockTokenEstimate(block);
  }
  return total;
}

/**
 * Total token estimate for an array of messages.
 */
export function messagesToTokenCount(messages: Message[]): number {
  let total = 0;
  for (const msg of messages) {
    total += messageTokenEstimate(msg);
  }
  return total;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Estimate tokens for a single content block. */
function contentBlockTokenEstimate(block: ContentBlock): number {
  switch (block.type) {
    case 'text':
      return estimateTokens(block.text);
    case 'thinking':
      return estimateTokens(block.thinking);
    case 'tool_use':
      return (
        estimateTokens(block.name) +
        estimateTokens(JSON.stringify(block.input))
      );
    case 'tool_result': {
      if (typeof block.content === 'string') {
        return estimateTokens(block.content);
      }
      let total = 0;
      for (const sub of block.content) {
        total += contentBlockTokenEstimate(sub);
      }
      return total;
    }
    case 'image':
      // Rough estimate for base64-encoded images
      return Math.ceil(block.source.data.length * 0.75 * 0.01);
    case 'document':
      return Math.ceil(block.source.data.length * 0.75 * 0.01);
    case 'signature':
      return estimateTokens(block.signature);
    default:
      return 0;
  }
}
