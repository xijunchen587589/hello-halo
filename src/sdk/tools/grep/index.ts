/**
 * @module tools/grep
 * GrepTool — content search powered by ripgrep (rg).
 * Falls back to a helpful error message if rg is not installed.
 * @license MIT
 */

import { spawn } from 'node:child_process';
import * as path from 'node:path';
import type { Tool, ToolContext, ToolResult, PermissionLevel } from '../../types/tool.js';
import { toolSuccess, toolError } from '../../types/tool.js';
import { name, description, inputSchema } from './schema.js';
import { extensionsForType } from './file-types.js';

const DEFAULT_HEAD_LIMIT = 250;
const MAX_OUTPUT_SIZE = 100_000; // characters

export class GrepTool implements Tool {
  readonly name = name;
  readonly description = description;
  readonly inputSchema: Record<string, unknown> = inputSchema;
  readonly permissionLevel: PermissionLevel = 'readonly';

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const pattern = input.pattern as string | undefined;
    if (!pattern) {
      return toolError('pattern is required');
    }

    const searchPath = input.path
      ? path.isAbsolute(input.path as string)
        ? (input.path as string)
        : path.resolve(ctx.cwd, input.path as string)
      : ctx.cwd;

    const outputMode = (input.output_mode as string) || 'files_with_matches';
    const headLimit = (input.head_limit as number) ?? DEFAULT_HEAD_LIMIT;
    const offset = (input.offset as number) ?? 0;
    const caseInsensitive = (input['-i'] as boolean) ?? false;
    const showLineNumbers = (input['-n'] as boolean) ?? true;
    const multiline = (input.multiline as boolean) ?? false;
    const contextLines = input.context as number | undefined;
    const contextA = input['-A'] as number | undefined;
    const contextB = input['-B'] as number | undefined;
    const contextC = input['-C'] as number | undefined;
    const fileType = input.type as string | undefined;
    const globPattern = input.glob as string | undefined;

    // Build rg arguments
    const args: string[] = [];

    // Output mode
    switch (outputMode) {
      case 'files_with_matches':
        args.push('-l');
        break;
      case 'count':
        args.push('-c');
        break;
      case 'content':
        // Default rg behavior — show matching lines
        if (showLineNumbers) {
          args.push('-n');
        }
        break;
    }

    // Case insensitive
    if (caseInsensitive) {
      args.push('-i');
    }

    // Multiline
    if (multiline) {
      args.push('-U');
      args.push('--multiline-dotall');
    }

    // Context lines
    if (contextC !== undefined) {
      args.push('-C', String(contextC));
    } else if (contextLines !== undefined) {
      args.push('-C', String(contextLines));
    } else {
      if (contextA !== undefined) {
        args.push('-A', String(contextA));
      }
      if (contextB !== undefined) {
        args.push('-B', String(contextB));
      }
    }

    // File type filter
    if (fileType) {
      const exts = extensionsForType(fileType);
      for (const ext of exts) {
        args.push('--glob', `*.${ext}`);
      }
    }

    // Glob filter
    if (globPattern) {
      args.push('--glob', globPattern);
    }

    // Head limit: use rg's --max-count for files_with_matches/count,
    // but for content mode we handle it after collecting output.

    // Pattern and path
    args.push('--', pattern, searchPath);

    // Execute ripgrep
    try {
      const output = await runRg(args, ctx.abortSignal);

      if (output.trim().length === 0) {
        return toolSuccess(
          `No matches found for pattern "${pattern}" in ${searchPath}`,
        );
      }

      // Apply offset and head_limit
      let lines = output.split('\n');
      if (offset > 0) {
        lines = lines.slice(offset);
      }
      if (headLimit > 0) {
        lines = lines.slice(0, headLimit);
      }

      let result = lines.join('\n');

      // Truncate if too large
      if (result.length > MAX_OUTPUT_SIZE) {
        result = result.slice(0, MAX_OUTPUT_SIZE) + '\n... [output truncated]';
      }

      return toolSuccess(result);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      if (errMsg.includes('ENOENT') || errMsg.includes('not found')) {
        return toolError(
          'ripgrep (rg) is not installed. Install it with: brew install ripgrep (macOS), ' +
            'apt install ripgrep (Ubuntu), or see https://github.com/BurntSushi/ripgrep',
        );
      }
      // rg exits with code 1 when no matches found — that's not an error
      if (errMsg.includes('exit code 1')) {
        return toolSuccess(
          `No matches found for pattern "${pattern}" in ${searchPath}`,
        );
      }
      return toolError(`Grep failed: ${errMsg}`);
    }
  }
}

/**
 * Run ripgrep as a child process and collect output.
 */
function runRg(args: string[], abortSignal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('rg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      // Early termination if output is too large
      if (stdout.length > MAX_OUTPUT_SIZE * 2) {
        proc.kill('SIGTERM');
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      reject(err);
    });

    proc.on('close', (code) => {
      if (code === 0 || code === 1) {
        // code 1 = no matches, which is fine
        resolve(stdout);
      } else {
        reject(new Error(`rg exit code ${code}: ${stderr}`));
      }
    });

    // Handle abort
    if (abortSignal) {
      const onAbort = () => {
        proc.kill('SIGTERM');
        reject(new Error('Grep aborted'));
      };
      if (abortSignal.aborted) {
        proc.kill('SIGTERM');
        reject(new Error('Grep aborted'));
        return;
      }
      abortSignal.addEventListener('abort', onAbort, { once: true });
      proc.on('close', () => {
        abortSignal.removeEventListener('abort', onAbort);
      });
    }
  });
}
