/**
 * @module tools/notebook-edit
 * NotebookEditTool — edit Jupyter notebook cells (.ipynb files).
 * @license MIT
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Tool, ToolContext, ToolResult, PermissionLevel } from '../../types/tool.js';
import { toolSuccess, toolError } from '../../types/tool.js';
import { name, description, inputSchema } from './schema.js';

interface NotebookJson {
  cells: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export class NotebookEditTool implements Tool {
  readonly name = name;
  readonly description = description;
  readonly inputSchema: Record<string, unknown> = inputSchema;
  readonly permissionLevel: PermissionLevel = 'write';

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const notebookPath = input.notebook_path as string | undefined;
    if (!notebookPath) {
      return toolError('notebook_path is required');
    }

    const resolvedPath = path.isAbsolute(notebookPath)
      ? notebookPath
      : path.resolve(ctx.cwd, notebookPath);

    // Validate extension
    if (path.extname(resolvedPath).toLowerCase() !== '.ipynb') {
      return toolError('File must have .ipynb extension');
    }

    const editMode = (input.edit_mode as string) || 'replace';
    const cellId = input.cell_id as string | undefined;
    const newSource = input.new_source as string | undefined;
    const cellType = (input.cell_type as string) || 'code';

    // Read notebook
    let rawContent: string;
    try {
      rawContent = await fs.readFile(resolvedPath, 'utf-8');
    } catch (e) {
      return toolError(
        `Failed to read notebook: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    let notebook: NotebookJson;
    try {
      notebook = JSON.parse(rawContent);
    } catch (e) {
      return toolError(
        `Invalid notebook JSON: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    if (!notebook.cells || !Array.isArray(notebook.cells)) {
      return toolError("Notebook has no 'cells' array");
    }

    // Perform the edit
    let message: string;

    switch (editMode) {
      case 'replace': {
        if (!cellId) {
          return toolError('cell_id is required for replace mode');
        }
        if (newSource === undefined) {
          return toolError('new_source is required for replace mode');
        }
        const idx = findCellIndex(notebook.cells, cellId);
        if (idx === -1) {
          return toolError(`Cell '${cellId}' not found`);
        }
        const cell = notebook.cells[idx];
        cell.source = sourceToArray(newSource);
        // Reset execution state for code cells
        if (cell.cell_type === 'code') {
          cell.outputs = [];
          cell.execution_count = null;
        }
        message = `Replaced cell '${cellId}' (index ${idx})`;
        break;
      }

      case 'insert': {
        if (newSource === undefined) {
          return toolError('new_source is required for insert mode');
        }
        let insertAt: number;
        if (cellId) {
          const idx = findCellIndex(notebook.cells, cellId);
          if (idx === -1) {
            return toolError(`Cell '${cellId}' not found`);
          }
          insertAt = idx + 1;
        } else {
          insertAt = 0;
        }
        const newCellId = generateCellId();
        const newCell = makeCell(cellType, newSource, newCellId);
        notebook.cells.splice(insertAt, 0, newCell);
        message = `Inserted ${cellType} cell '${newCellId}' at position ${insertAt}`;
        break;
      }

      case 'delete': {
        if (!cellId) {
          return toolError('cell_id is required for delete mode');
        }
        const idx = findCellIndex(notebook.cells, cellId);
        if (idx === -1) {
          return toolError(`Cell '${cellId}' not found`);
        }
        notebook.cells.splice(idx, 1);
        message = `Deleted cell '${cellId}' (was at index ${idx})`;
        break;
      }

      default:
        return toolError(`Unknown edit_mode: ${editMode}`);
    }

    // Write back
    const updatedContent = JSON.stringify(notebook, null, 1) + '\n';
    try {
      await fs.writeFile(resolvedPath, updatedContent, 'utf-8');
    } catch (e) {
      return toolError(
        `Failed to write notebook: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    // Record file change for undo/rewind
    if (ctx.recordFileChange) {
      ctx.recordFileChange(
        resolvedPath,
        Buffer.from(rawContent, 'utf-8'),
        Buffer.from(updatedContent, 'utf-8'),
      );
    }

    return toolSuccess(message);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find a cell by "cell-N" index notation or by UUID.
 * Returns -1 if not found.
 */
function findCellIndex(cells: Array<Record<string, unknown>>, cellId: string): number {
  // Try "cell-N" index format first
  const cellIndexMatch = cellId.match(/^cell-(\d+)$/);
  if (cellIndexMatch) {
    const idx = parseInt(cellIndexMatch[1], 10);
    if (idx < cells.length) {
      return idx;
    }
    return -1;
  }

  // Try UUID match
  for (let i = 0; i < cells.length; i++) {
    if (cells[i].id === cellId) {
      return i;
    }
  }

  return -1;
}

/** Convert source string to the array-of-lines format used by .ipynb. */
function sourceToArray(source: string): string[] {
  if (source.length === 0) return [];
  // split_inclusive behavior: keep newlines attached to lines
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') {
      lines.push(source.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < source.length) {
    lines.push(source.slice(start));
  }
  return lines;
}

/** Generate a simple random cell ID (8 hex chars). */
function generateCellId(): string {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 0xffffffff);
  return ((timestamp ^ random) & 0xffffffff).toString(16).padStart(8, '0');
}

/** Build a new cell JSON object. */
function makeCell(
  cellType: string,
  source: string,
  cellId: string,
): Record<string, unknown> {
  const sourceLines = sourceToArray(source);

  if (cellType === 'markdown') {
    return {
      cell_type: 'markdown',
      id: cellId,
      metadata: {},
      source: sourceLines,
    };
  }

  return {
    cell_type: 'code',
    id: cellId,
    metadata: {},
    source: sourceLines,
    outputs: [],
    execution_count: null,
  };
}
