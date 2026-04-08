/**
 * @module tools/worktree/exit
 * ExitWorktreeTool — Exit the current worktree session.
 * @license MIT
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Tool, ToolContext, ToolResult } from '../../types/tool.js';
import { toolSuccess, toolError } from '../../types/tool.js';
import {
  EXIT_WORKTREE_TOOL_NAME,
  EXIT_WORKTREE_TOOL_DESCRIPTION,
  EXIT_WORKTREE_INPUT_SCHEMA,
} from './schema.js';
import { worktreeSession } from './state.js';

const execFileAsync = promisify(execFile);

/** Run a git command, returning stdout. Throws on failure. */
async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout;
}

export const ExitWorktreeTool: Tool = {
  name: EXIT_WORKTREE_TOOL_NAME,
  description: EXIT_WORKTREE_TOOL_DESCRIPTION,
  inputSchema: EXIT_WORKTREE_INPUT_SCHEMA,
  permissionLevel: 'write',

  async execute(
    input: Record<string, unknown>,
    _ctx: ToolContext,
  ): Promise<ToolResult> {
    const session = worktreeSession.get();
    if (!session) {
      return toolError(
        'No-op: there is no active EnterWorktree session to exit. ' +
        'This tool only operates on worktrees created by EnterWorktree in the current session.',
      );
    }

    const action = input.action as string;
    if (action !== 'keep' && action !== 'remove') {
      return toolError(`Unknown action '${action}'. Use 'keep' or 'remove'.`);
    }

    const discardChanges = Boolean(input.discard_changes);

    // If removing, check for uncommitted changes unless discardChanges is set
    if (action === 'remove' && !discardChanges) {
      try {
        const statusOutput = await runGit(session.worktreePath, ['status', '--porcelain']);
        const changedFiles = statusOutput
          .split('\n')
          .filter((l) => l.trim().length > 0).length;

        let commitCount = 0;
        if (session.originalHead) {
          try {
            const revOutput = await runGit(session.worktreePath, [
              'rev-list',
              '--count',
              `${session.originalHead}..HEAD`,
            ]);
            commitCount = parseInt(revOutput.trim(), 10) || 0;
          } catch {
            // Non-fatal
          }
        }

        if (changedFiles > 0 || commitCount > 0) {
          const parts: string[] = [];
          if (changedFiles > 0) parts.push(`${changedFiles} uncommitted file(s)`);
          if (commitCount > 0)
            parts.push(`${commitCount} commit(s) on the worktree branch`);

          return toolError(
            `Worktree has ${parts.join(' and ')}. Removing will discard this work permanently. ` +
            `Confirm with the user, then re-invoke with discard_changes=true — ` +
            `or use action="keep" to preserve the worktree.`,
          );
        }
      } catch {
        // Non-fatal: if we can't check, proceed cautiously
      }
    }

    // Clear session state
    worktreeSession.clear();

    if (action === 'keep') {
      // Lock the worktree so git doesn't prune it
      try {
        await runGit(session.originalCwd, [
          'worktree', 'lock',
          '--reason', 'kept by ExitWorktree',
          session.worktreePath,
        ]);
      } catch {
        // Non-fatal
      }

      return toolSuccess(
        `Exited worktree. Work preserved at ${session.worktreePath} on branch ${session.branch}. ` +
        `Session is now back in ${session.originalCwd}.`,
      );
    }

    // action === 'remove'
    try {
      await runGit(session.originalCwd, [
        'worktree', 'remove', '--force', session.worktreePath,
      ]);
    } catch {
      // Non-fatal: worktree may already be gone
    }

    // Delete the branch
    if (session.branch) {
      try {
        await runGit(session.originalCwd, ['branch', '-D', session.branch]);
      } catch {
        // Non-fatal: branch may not exist
      }
    }

    return toolSuccess(
      `Exited and removed worktree at ${session.worktreePath}. ` +
      `Session is now back in ${session.originalCwd}.`,
    );
  },
};
