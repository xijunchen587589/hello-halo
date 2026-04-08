/**
 * @module tools/edit
 * EditTool — exact string replacement in files.
 * @license MIT
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Tool, ToolContext, ToolResult, PermissionLevel } from '../../types/tool.js';
import { toolSuccess, toolError } from '../../types/tool.js';
import { name, description, inputSchema } from './schema.js';
import { tryFormatFile } from './format.js';

export class EditTool implements Tool {
  readonly name = name;
  readonly description = description;
  readonly inputSchema: Record<string, unknown> = inputSchema;
  readonly permissionLevel: PermissionLevel = 'write';

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const filePath = input.file_path as string | undefined;
    const oldString = input.old_string as string | undefined;
    const newString = input.new_string as string | undefined;
    const replaceAll = (input.replace_all as boolean) ?? false;

    if (!filePath) {
      return toolError('file_path is required');
    }
    if (oldString === undefined || oldString === null) {
      return toolError('old_string is required');
    }
    if (newString === undefined || newString === null) {
      return toolError('new_string is required');
    }

    // Validate old != new
    if (oldString === newString) {
      return toolError('old_string and new_string must be different');
    }

    const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.cwd, filePath);

    // Read current content
    let content: string;
    try {
      content = await fs.readFile(resolvedPath, 'utf-8');
    } catch (e) {
      return toolError(
        `Failed to read file ${resolvedPath}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    // Count occurrences
    let count = 0;
    let searchFrom = 0;
    while (true) {
      const idx = content.indexOf(oldString, searchFrom);
      if (idx === -1) break;
      count++;
      searchFrom = idx + oldString.length;
    }

    if (count === 0) {
      return toolError(
        `old_string not found in ${resolvedPath}. Make sure the string matches exactly, ` +
          'including whitespace and indentation.',
      );
    }

    if (count > 1 && !replaceAll) {
      return toolError(
        `old_string appears ${count} times in ${resolvedPath}. Either provide a larger string ` +
          'with more surrounding context to make it unique, or set replace_all ' +
          'to true to replace every occurrence.',
      );
    }

    // Perform replacement
    let newContent: string;
    if (replaceAll) {
      newContent = content.split(oldString).join(newString);
    } else {
      // Replace only first occurrence
      const idx = content.indexOf(oldString);
      newContent = content.slice(0, idx) + newString + content.slice(idx + oldString.length);
    }

    // Write back
    try {
      await fs.writeFile(resolvedPath, newContent, 'utf-8');
    } catch (e) {
      return toolError(
        `Failed to write file ${resolvedPath}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    // Record file change for undo/rewind
    if (ctx.recordFileChange) {
      ctx.recordFileChange(
        resolvedPath,
        Buffer.from(content, 'utf-8'),
        Buffer.from(newContent, 'utf-8'),
      );
    }

    // Optional formatting
    await tryFormatFile(resolvedPath);

    const replacements = replaceAll ? count : 1;
    return toolSuccess(
      `Successfully edited ${resolvedPath} (${replacements} replacement${replacements !== 1 ? 's' : ''}).`,
      {
        file_path: resolvedPath,
        replacements,
      },
    );
  }
}
