/**
 * @module tools/ask-user
 * AskUserQuestionTool — ask the human operator a question.
 *
 * The actual prompt/response is handled at the host application layer.
 * This tool returns a placeholder with metadata that the SDK consumer
 * intercepts to display the question and collect the answer.
 * @license MIT
 */

import type { Tool, ToolContext, ToolResult } from '../../types/tool.js';
import { toolSuccess, toolError } from '../../types/tool.js';
import {
  ASK_USER_TOOL_NAME,
  ASK_USER_TOOL_DESCRIPTION,
  ASK_USER_TOOL_INPUT_SCHEMA,
} from './schema.js';

export const AskUserQuestionTool: Tool = {
  name: ASK_USER_TOOL_NAME,
  description: ASK_USER_TOOL_DESCRIPTION,
  inputSchema: ASK_USER_TOOL_INPUT_SCHEMA as unknown as Record<string, unknown>,
  permissionLevel: 'none',

  async execute(
    input: Record<string, unknown>,
    _ctx: ToolContext,
  ): Promise<ToolResult> {
    const question = input.question as string | undefined;

    if (!question || typeof question !== 'string') {
      return toolError('Missing required parameter: question');
    }

    const options = input.options as string[] | undefined;

    return toolSuccess(`Question: ${question}`, {
      question,
      options: options ?? null,
      type: 'ask_user',
    });
  },
};
