/**
 * @module tools/agent
 * AgentTool — spawn a sub-agent to handle complex sub-tasks.
 *
 * The actual spawning is done by the orchestrator; this tool builds
 * a spawn request and delegates to the registered spawner.
 * Call `setSpawner()` to register the real spawn implementation
 * (done automatically by `initOrchestrator()`).
 * @license MIT
 */

import type { Tool, ToolContext, ToolResult } from '../../types/tool.js';
import { toolSuccess, toolError } from '../../types/tool.js';
import {
  AGENT_TOOL_NAME,
  AGENT_TOOL_DESCRIPTION,
  AGENT_TOOL_INPUT_SCHEMA,
} from './schema.js';
import { resolveAgentType, type AgentTypeDefinition } from './agent-types.js';

// ---------------------------------------------------------------------------
// Spawner injection (set by orchestrator in Phase 3)
// ---------------------------------------------------------------------------

export interface AgentSpawnRequest {
  description: string;
  prompt: string;
  tools?: string[];
  systemPrompt?: string;
  maxTurns?: number;
  model?: string;
  isolation?: 'worktree';
  runInBackground?: boolean;
  /** Resolved agent type definition (if subagent_type was provided). */
  agentType?: AgentTypeDefinition;
}

export type AgentSpawner = (
  request: AgentSpawnRequest,
  ctx: ToolContext,
) => Promise<ToolResult>;

let _spawner: AgentSpawner | null = null;

/**
 * Register the real agent spawner implementation.
 * Called by the orchestrator to connect the AgentTool to the
 * actual sub-agent spawning logic.
 * Pass `null` to reset to stub mode.
 */
export function setSpawner(spawner: AgentSpawner | null): void {
  _spawner = spawner;
}

// ---------------------------------------------------------------------------
// AgentTool
// ---------------------------------------------------------------------------

export const AgentTool: Tool = {
  name: AGENT_TOOL_NAME,
  description: AGENT_TOOL_DESCRIPTION,
  inputSchema: AGENT_TOOL_INPUT_SCHEMA as unknown as Record<string, unknown>,
  permissionLevel: 'execute',

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const description = input.description as string | undefined;
    const prompt = input.prompt as string | undefined;

    if (!description || typeof description !== 'string') {
      return toolError('Missing required parameter: description');
    }
    if (!prompt || typeof prompt !== 'string') {
      return toolError('Missing required parameter: prompt');
    }

    // Resolve agent type if provided via subagent_type
    const subagentType = input.subagent_type as string | undefined;
    const agentType = subagentType ? resolveAgentType(subagentType) : undefined;

    // Build the spawn request
    const request: AgentSpawnRequest = {
      description,
      prompt,
      tools: (input.tools as string[] | undefined) ?? agentType?.tools,
      systemPrompt: input.system_prompt as string | undefined,
      maxTurns: input.max_turns as number | undefined,
      model: (input.model as string | undefined) ?? agentType?.model,
      isolation: input.isolation as 'worktree' | undefined,
      runInBackground: input.run_in_background as boolean | undefined,
      agentType,
    };

    // If a real spawner is registered, use it
    if (_spawner) {
      return _spawner(request, ctx);
    }

    // Stub mode: return placeholder result
    const agentId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    if (request.runInBackground) {
      return toolSuccess(
        JSON.stringify({
          agent_id: agentId,
          status: 'running',
          message:
            `Agent '${description}' started in background. ` +
            `Use poll_background_agent with agent_id '${agentId}' to check status.`,
        }),
      );
    }

    return toolSuccess(
      `[Agent stub] Task "${description}" received. ` +
        'Agent spawning will be connected in Phase 3 (orchestrator).',
    );
  },
};
