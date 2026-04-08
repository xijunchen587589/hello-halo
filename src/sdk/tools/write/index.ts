/**
 * @module tools/write
 * WriteTool — writes files to the local filesystem.
 * @license MIT
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Tool, ToolContext, ToolResult, PermissionLevel } from '../../types/tool.js';
import { toolSuccess, toolError } from '../../types/tool.js';
import { name, description, inputSchema } from './schema.js';

export class WriteTool implements Tool {
  readonly name = name;
  readonly description = description;
  readonly inputSchema: Record<string, unknown> = inputSchema;
  readonly permissionLevel: PermissionLevel = 'write';

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const filePath = input.file_path as string | undefined;
    const content = input.content as string | undefined;

    if (!filePath) {
      return toolError('file_path is required');
    }
    if (content === undefined || content === null) {
      return toolError('content is required');
    }

    const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.cwd, filePath);

    // Ensure parent directories exist
    const parentDir = path.dirname(resolvedPath);
    try {
      await fs.mkdir(parentDir, { recursive: true });
    } catch (e) {
      return toolError(
        `Failed to create directory ${parentDir}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    // Check if file already exists (for the "Created" vs "Wrote" message)
    let existed = false;
    let beforeContent: Buffer = Buffer.alloc(0);
    try {
      beforeContent = await fs.readFile(resolvedPath);
      existed = true;
    } catch {
      // File does not exist yet — that's fine
    }

    // Write file
    try {
      await fs.writeFile(resolvedPath, content, 'utf-8');
    } catch (e) {
      return toolError(
        `Failed to write file ${resolvedPath}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    // Record file change for undo/rewind
    if (ctx.recordFileChange) {
      ctx.recordFileChange(resolvedPath, beforeContent, Buffer.from(content, 'utf-8'));
    }

    const lineCount = content.split('\n').length;
    const byteCount = Buffer.byteLength(content, 'utf-8');
    const action = existed ? 'Wrote' : 'Created';

    return toolSuccess(
      `${action} ${resolvedPath} (${lineCount} lines, ${byteCount} bytes)`,
      {
        file_path: resolvedPath,
        is_new: !existed,
        lines: lineCount,
        bytes: byteCount,
      },
    );
  }
}
