/**
 * @module tools/web-search
 * WebSearchTool — Search the web for information.
 * This is a placeholder/interface tool. The host should provide an actual
 * search implementation via MCP or custom tool configuration.
 * @license MIT
 */

import type { Tool, ToolContext, ToolResult } from '../../types/tool.js';
import { toolSuccess, toolError } from '../../types/tool.js';
import { WEB_SEARCH_TOOL_NAME, WEB_SEARCH_TOOL_DESCRIPTION, WEB_SEARCH_INPUT_SCHEMA } from './schema.js';

export const WebSearchTool: Tool = {
  name: WEB_SEARCH_TOOL_NAME,
  description: WEB_SEARCH_TOOL_DESCRIPTION,
  inputSchema: WEB_SEARCH_INPUT_SCHEMA,
  permissionLevel: 'readonly',

  async execute(
    input: Record<string, unknown>,
    _ctx: ToolContext,
  ): Promise<ToolResult> {
    const query = input.query as string | undefined;
    if (!query || typeof query !== 'string') {
      return toolError('Missing required parameter: query');
    }

    // This tool is a placeholder. The host application should provide
    // an actual search implementation via MCP server or by overriding
    // this tool with a custom implementation.
    return toolSuccess(
      'Web search is not configured. To enable web search, the host application ' +
      'should provide a search implementation via an MCP server or custom tool. ' +
      `Query was: "${query}"`,
    );
  },
};
