/**
 * @module tools/worktree/enter
 * EnterWorktreeTool — Create a new git worktree and switch the session into it.
 * @license MIT
 */

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Tool, ToolContext, ToolResult } from '../../types/tool.js';
import { toolSuccess, toolError } from '../../types/tool.js';
import {
  ENTER_WORKTREE_TOOL_NAME,
  ENTER_WORKTREE_TOOL_DESCRIPTION,
  ENTER_WORKTREE_INPUT_SCHEMA,
} from './schema.js';
import { worktreeSession, type WorktreeSessionInfo } from './state.js';

const execFileAsync = promisify(execFile);

/** Run a git command and return stdout. */
async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout;
}

export const EnterWorktreeTool: Tool = {
  name: ENTER_WORKTREE_TOOL_NAME,
  description: ENTER_WORKTREE_TOOL_DESCRIPTION,
  inputSchema: ENTER_WORKTREE_INPUT_SCHEMA,
  permissionLevel: 'write',

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    // Check if already in a worktree session
    if (worktreeSession.get()) {
      return toolError('Already in a worktree session. Call ExitWorktree first.');
    }

    const name = (input.name as string) || randomUUID().slice(0, 8);

    // Validate name: each "/"-separated segment may contain only letters, digits, dots, underscores, dashes
    if (name.length > 64) {
      return toolError('Worktree name must be 64 characters or fewer.');
    }
    const nameRegex = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
    if (!nameRegex.test(name)) {
      return toolError(
        'Invalid worktree name. Each "/"-separated segment may contain only letters, digits, dots, underscores, and dashes.',
      );
    }

    // Verify we are inside a git repository
    let originalHead: string | null = null;
    try {
      const headOutput = await runGit(ctx.cwd, ['rev-parse', 'HEAD']);
      originalHead = headOutput.trim();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('not a git repository') || msg.toLowerCase().includes('fatal')) {
        return toolError(
          `Cannot create worktree: the current directory '${ctx.cwd}' is not inside a git repository.`,
        );
      }
      // Non-fatal: might be an empty repo
    }

    // Determine worktree path: .claude/worktrees/<name>
    const worktreePath = join(ctx.cwd, '.claude', 'worktrees', name);

    // Create the branch name from the worktree name
    const branch = `claude-worktree-${name}`;

    // Create the worktree
    try {
      await runGit(ctx.cwd, ['worktree', 'add', '-b', branch, worktreePath]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const trimmed = msg.trim();
      if (trimmed.toLowerCase().includes('already exists')) {
        return toolError(
          `Failed to create worktree: branch '${branch}' already exists. Use a different name or delete the existing branch first.`,
        );
      }
      return toolError(`Failed to create worktree: ${trimmed}`);
    }

    // Save session state
    const session: WorktreeSessionInfo = {
      originalCwd: ctx.cwd,
      worktreePath,
      branch,
      originalHead,
    };
    worktreeSession.set(session);

    return toolSuccess(
      `Created worktree at ${worktreePath} on branch '${branch}'.\n` +
      `The working directory is now ${worktreePath}.\n` +
      `Use ExitWorktree to return to ${ctx.cwd}.`,
    );
  },
};
