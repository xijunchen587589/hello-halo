/**
 * @module tools/team/delete
 * TeamDeleteTool — cancel a running team and clean up its directories.
 * @license MIT
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Tool, ToolContext, ToolResult } from '../../types/tool.js';
import { toolSuccess, toolError } from '../../types/tool.js';
import {
  TEAM_DELETE_TOOL_NAME,
  TEAM_DELETE_DESCRIPTION,
  TEAM_DELETE_INPUT_SCHEMA,
} from './schema.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function teamDir(teamName: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || '/tmp';
  return path.join(home, '.claude', 'teams', sanitizeName(teamName));
}

// ---------------------------------------------------------------------------
// TeamDeleteTool
// ---------------------------------------------------------------------------

export const TeamDeleteTool: Tool = {
  name: TEAM_DELETE_TOOL_NAME,
  description: TEAM_DELETE_DESCRIPTION,
  inputSchema: TEAM_DELETE_INPUT_SCHEMA as unknown as Record<string, unknown>,
  permissionLevel: 'write',

  async execute(
    input: Record<string, unknown>,
    _ctx: ToolContext,
  ): Promise<ToolResult> {
    const teamName = input.team_name as string | undefined;

    if (!teamName?.trim()) {
      return toolError('team_name is required for TeamDelete');
    }

    const dir = teamDir(teamName);

    if (!fs.existsSync(dir)) {
      return toolSuccess(
        JSON.stringify({
          success: true,
          message: `Team '${teamName}' directory not found (may have been cleaned up already).`,
          team_name: teamName,
          cancelled_agents: 0,
        }),
      );
    }

    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      return toolError(
        `Failed to remove team directory '${dir}': ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    return toolSuccess(
      JSON.stringify({
        success: true,
        message: `Cleaned up team "${teamName}".`,
        team_name: teamName,
        cancelled_agents: 0,
      }),
    );
  },
};
