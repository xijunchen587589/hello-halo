/**
 * @module tools/glob
 * GlobTool — fast file pattern matching.
 * @license MIT
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Tool, ToolContext, ToolResult, PermissionLevel } from '../../types/tool.js';
import { toolSuccess, toolError } from '../../types/tool.js';
import { name, description, inputSchema } from './schema.js';

const MAX_RESULTS = 250;

export class GlobTool implements Tool {
  readonly name = name;
  readonly description = description;
  readonly inputSchema: Record<string, unknown> = inputSchema;
  readonly permissionLevel: PermissionLevel = 'readonly';

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const pattern = input.pattern as string | undefined;
    if (!pattern) {
      return toolError('pattern is required');
    }

    const baseDir = input.path
      ? path.isAbsolute(input.path as string)
        ? (input.path as string)
        : path.resolve(ctx.cwd, input.path as string)
      : ctx.cwd;

    // Validate directory exists
    try {
      const stat = await fs.stat(baseDir);
      if (!stat.isDirectory()) {
        return toolError(`Not a directory: ${baseDir}`);
      }
    } catch {
      return toolError(`Directory not found: ${baseDir}`);
    }

    // Walk directory recursively and match pattern
    const entries: Array<{ filePath: string; mtime: number }> = [];

    try {
      await walkAndMatch(baseDir, pattern, entries);
    } catch (e) {
      return toolError(
        `Glob failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    if (entries.length === 0) {
      return toolSuccess(
        `No files matched pattern "${pattern}" in ${baseDir}`,
      );
    }

    // Sort by modification time (most recent first)
    entries.sort((a, b) => b.mtime - a.mtime);

    const total = entries.length;
    const truncated = total > MAX_RESULTS;

    let output = '';
    for (let i = 0; i < Math.min(total, MAX_RESULTS); i++) {
      output += entries[i].filePath + '\n';
    }

    if (truncated) {
      output += `\n... and ${total - MAX_RESULTS} more files (showing first ${MAX_RESULTS})\n`;
    }

    return toolSuccess(output);
  }
}

/**
 * Recursively walk a directory and collect files matching a glob pattern.
 * Uses a simple glob matcher that supports *, **, and ? wildcards.
 */
async function walkAndMatch(
  dir: string,
  pattern: string,
  results: Array<{ filePath: string; mtime: number }>,
): Promise<void> {
  // Skip common non-interesting directories
  const SKIP_DIRS = new Set([
    'node_modules', '.git', '.hg', '.svn', '__pycache__',
    'target', 'dist', 'build', '.next', '.nuxt',
  ]);

  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Skip hidden dirs and common large dirs
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) {
        continue;
      }
      await walkAndMatch(fullPath, pattern, results);
    } else if (entry.isFile()) {
      // Match against pattern
      if (matchGlob(pattern, fullPath, dir)) {
        try {
          const stat = await fs.stat(fullPath);
          results.push({ filePath: fullPath, mtime: stat.mtimeMs });
        } catch {
          // Skip files we can't stat
        }
      }
    }
  }
}

/**
 * Simple glob matcher supporting *, **, and ? patterns.
 * The pattern is matched against the path relative to the base directory.
 */
function matchGlob(pattern: string, filePath: string, baseDir: string): boolean {
  const relativePath = path.relative(baseDir, filePath);

  // Convert glob pattern to regex
  let regexStr = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/' || pattern[i + 2] === path.sep) {
          // **/ matches any number of directories
          regexStr += '(?:.+[\\/])?';
          i += 3;
          continue;
        }
        // ** at the end matches everything
        regexStr += '.*';
        i += 2;
        continue;
      }
      // * matches anything except path separator
      regexStr += '[^\\/]*';
      i++;
    } else if (ch === '?') {
      regexStr += '[^\\/]';
      i++;
    } else if (ch === '.') {
      regexStr += '\\.';
      i++;
    } else if (ch === '/' || ch === path.sep) {
      regexStr += '[\\/]';
      i++;
    } else {
      regexStr += ch;
      i++;
    }
  }

  try {
    const regex = new RegExp(`^${regexStr}$`, 'i');
    return regex.test(relativePath);
  } catch {
    return false;
  }
}
