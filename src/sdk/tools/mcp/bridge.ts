/**
 * @module tools/mcp/bridge
 * Bridges SDK MCP server tools into the query loop's Tool interface.
 *
 * When `options.mcpServers` contains SDK-type servers (created by
 * `createSdkMcpServer()`), this module extracts their tool definitions
 * and wraps them as `Tool` instances that the query loop can execute.
 *
 * Tool names follow the MCP convention: `mcp__{serverName}__{toolName}`
 * (matching CC SDK behavior for MCP tool naming).
 *
 * @license MIT
 */

import type { Tool, ToolResult, ToolContext } from '../../types/tool.js';
import type { McpSdkServerConfigWithInstance, SdkMcpServerInstance } from './sdk-server.js';

// ---------------------------------------------------------------------------
// MCP tool name conventions
// ---------------------------------------------------------------------------

/**
 * Build the namespaced tool name for an MCP tool.
 * Convention: `mcp__{server-name}__{tool-name}`
 *
 * Server names may contain hyphens (e.g. "halo-report"), which are
 * preserved as-is to match CC SDK behavior.
 */
function mcpToolName(serverName: string, toolName: string): string {
  return `mcp__${serverName}__${toolName}`;
}

// ---------------------------------------------------------------------------
// Bridge: SdkMcpServerInstance → Tool[]
// ---------------------------------------------------------------------------

/**
 * Extract all tools from an SDK MCP server and wrap them as SDK `Tool`
 * objects that can be added to the query loop.
 *
 * @param serverConfig - The SDK server config with live instance
 * @returns Array of Tool objects
 */
export function bridgeSdkMcpTools(serverConfig: McpSdkServerConfigWithInstance): Tool[] {
  const { name: serverName, instance } = serverConfig;
  const mcpTools = instance.listTools();
  return mcpTools.map((mcpTool) =>
    createBridgedTool(
      serverName,
      mcpTool as {
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
        annotations?: Record<string, unknown>;
      },
      instance,
    ),
  );
}

/**
 * Create a single bridged Tool from an MCP tool definition.
 */
function createBridgedTool(
  serverName: string,
  mcpTool: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    annotations?: Record<string, unknown>;
  },
  instance: SdkMcpServerInstance,
): Tool {
  const fullName = mcpToolName(serverName, mcpTool.name);

  return {
    name: fullName,
    description: mcpTool.description,
    inputSchema: mcpTool.inputSchema,
    // MCP tools are assumed to require execution-level permissions since
    // their capabilities are unknown to the SDK.
    permissionLevel: 'execute' as const,

    async execute(
      input: Record<string, unknown>,
      _ctx: ToolContext,
    ): Promise<ToolResult> {
      const result = await instance.callTool(mcpTool.name, input);

      if (!result) {
        return {
          content: `MCP tool "${mcpTool.name}" not found on server "${serverName}".`,
          isError: true,
        };
      }

      // Convert CallToolResult.content to a flat string.
      // CC SDK always serializes MCP tool results to a single text string
      // for the LLM's tool_result content block.
      const textParts: string[] = [];
      for (const block of result.content) {
        if (block.type === 'text' && typeof (block as any).text === 'string') {
          textParts.push((block as any).text);
        } else if (block.type === 'image') {
          textParts.push(`[Image: ${(block as any).mimeType ?? 'unknown'}]`);
        } else {
          // Other block types — serialize as JSON
          textParts.push(JSON.stringify(block));
        }
      }

      return {
        content: textParts.join('\n'),
        isError: result.isError ?? false,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Utility: detect SDK-type MCP server configs
// ---------------------------------------------------------------------------

/**
 * Check if a server config is an SDK-type config with a live instance.
 */
export function isSdkMcpServerConfig(config: unknown): config is McpSdkServerConfigWithInstance {
  if (!config || typeof config !== 'object') return false;
  const obj = config as Record<string, unknown>;
  return obj.type === 'sdk' && 'instance' in obj && obj.instance != null;
}

/**
 * Extract all bridged tools from a `mcpServers` record.
 *
 * Filters for SDK-type configs, bridges their tools, and returns
 * a flat array of Tool objects ready for the query loop.
 *
 * Non-SDK configs (stdio, sse, http) are skipped — those require
 * an external MCP transport (not yet implemented).
 *
 * @param mcpServers - The mcpServers record from Options
 * @returns Array of bridged Tool objects
 */
export function extractSdkMcpTools(
  mcpServers: Record<string, unknown> | undefined,
): Tool[] {
  if (!mcpServers) return [];

  const tools: Tool[] = [];
  for (const [_name, config] of Object.entries(mcpServers)) {
    if (isSdkMcpServerConfig(config)) {
      tools.push(...bridgeSdkMcpTools(config));
    }
  }
  return tools;
}
