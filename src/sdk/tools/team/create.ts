/**
 * @module tools/team/create
 * TeamCreateTool — create a named team of agents.
 *
 * This is a STUB — actual agent spawning requires the orchestrator (Phase 3).
 * For now it writes the team config to disk and returns the config path.
 * @license MIT
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Tool, ToolContext, ToolResult } from '../../types/tool.js';
import { toolSuccess, toolError } from '../../types/tool.js';
import {
  TEAM_CREATE_TOOL_NAME,
  TEAM_CREATE_DESCRIPTION,
  TEAM_CREATE_INPUT_SCHEMA,
} from './schema.js';

// ---------------------------------------------------------------------------
// Agent runner injection (set by orchestrator in Phase 3)
// ---------------------------------------------------------------------------

export type AgentRunFn = (
  description: string,
  prompt: string,
  tools: string[] | undefined,
  system: string | undefined,
  maxTurns: number | undefined,
  ctx: ToolContext,
) => Promise<string>;

let _agentRunner: AgentRunFn | null = null;

/** Register the global agent runner. Called once at startup by the orchestrator. */
export function registerAgentRunner(fn: AgentRunFn): void {
  _agentRunner = fn;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function teamsBaseDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '/tmp';
  return path.join(home, '.claude', 'teams');
}

// ---------------------------------------------------------------------------
// TeamCreateTool
// ---------------------------------------------------------------------------

export const TeamCreateTool: Tool = {
  name: TEAM_CREATE_TOOL_NAME,
  description: TEAM_CREATE_DESCRIPTION,
  inputSchema: TEAM_CREATE_INPUT_SCHEMA as unknown as Record<string, unknown>,
  permissionLevel: 'write',

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const teamName = input.team_name as string | undefined;
    const task = input.task as string | undefined;

    if (!teamName?.trim()) {
      return toolError('team_name is required for TeamCreate');
    }
    if (!task?.trim()) {
      return toolError('task is required for TeamCreate');
    }

    const agents = (input.agents ?? []) as Array<Record<string, unknown>>;
    const parallel = input.parallel !== false; // default true
    const description = input.description as string | undefined;

    const safeName = sanitizeName(teamName);
    const leadAgentId = `team-lead@${safeName}`;

    // Resolve team directory
    let finalDir = path.join(teamsBaseDir(), safeName);
    let finalName = safeName;

    if (fs.existsSync(finalDir)) {
      const suffix = Math.random().toString(36).slice(2, 8);
      finalName = `${safeName}-${suffix}`;
      finalDir = path.join(teamsBaseDir(), finalName);
    }

    fs.mkdirSync(finalDir, { recursive: true });

    const now = Date.now();
    const members = agents.map((spec, i) => ({
      agent_id: `agent-${i}@${finalName}`,
      name: spec.name as string,
      role: (spec.role as string) || 'assistant',
      joined_at: now,
      tools: spec.tools as string[] | undefined,
    }));

    const config = {
      name: finalName,
      task,
      description,
      created_at: now,
      lead_agent_id: leadAgentId,
      lead_session_id: ctx.sessionId,
      parallel,
      members,
    };

    const configPath = path.join(finalDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    const resultsPath = path.join(finalDir, 'results.json');
    fs.writeFileSync(resultsPath, '[]');

    // If no agents specified, return config info
    if (agents.length === 0) {
      return toolSuccess(
        JSON.stringify({
          team_name: finalName,
          team_file_path: configPath,
          lead_agent_id: leadAgentId,
          agents_spawned: 0,
          results: [],
        }),
      );
    }

    // If agent runner is registered, spawn agents
    if (_agentRunner) {
      const agentFutures = agents.map((spec) => {
        const agentName = spec.name as string;
        const role = (spec.role as string) || 'assistant';
        const tools = spec.tools as string[] | undefined;
        const agentTask = (spec.task as string) || task;

        const systemPrompt =
          `You are agent '${agentName}' on team '${finalName}'. Your role: ${role}.\n` +
          'Work on the assigned task thoroughly and return your complete findings.';

        const desc = `${finalName}/${agentName}`;

        return _agentRunner!(desc, agentTask, tools, systemPrompt, 10, ctx).then(
          (output) => ({ agent: agentName, output }),
        );
      });

      const agentResults = parallel
        ? await Promise.all(agentFutures)
        : await agentFutures.reduce(
            async (acc, future) => {
              const results = await acc;
              results.push(await future);
              return results;
            },
            Promise.resolve([] as Array<{ agent: string; output: string }>),
          );

      // Persist results
      fs.writeFileSync(resultsPath, JSON.stringify(agentResults, null, 2));

      const aggregated = agentResults
        .map((r) => `## Agent: ${r.agent}\n\n${r.output}`)
        .join('\n\n');

      return toolSuccess(
        JSON.stringify({
          team_name: finalName,
          team_file_path: configPath,
          lead_agent_id: leadAgentId,
          agents_spawned: agentResults.length,
          parallel,
          results: agentResults,
          aggregated_output: aggregated.trim(),
        }),
      );
    }

    // Stub mode: no agent runner registered
    return toolSuccess(
      JSON.stringify({
        team_name: finalName,
        team_file_path: configPath,
        lead_agent_id: leadAgentId,
        agents_spawned: agents.length,
        parallel,
        results: agents.map((s) => ({
          agent: s.name,
          output: '[Agent runner not registered — connect orchestrator in Phase 3]',
        })),
      }),
    );
  },
};
