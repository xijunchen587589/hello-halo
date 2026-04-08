/**
 * @module tools/notebook-edit/schema
 * Notebook Edit tool description and input schema.
 * @license MIT
 */

export const name = 'NotebookEdit';

export const description =
  'Edit cells in a Jupyter notebook (.ipynb file). Supports three edit modes:\n' +
  '- replace: modify an existing cell\'s source (requires cell_id)\n' +
  '- insert: add a new cell after a given cell (or at the start if no cell_id)\n' +
  '- delete: remove a cell (requires cell_id)\n' +
  'You MUST read the notebook file before editing.';

export const inputSchema = {
  type: 'object',
  properties: {
    notebook_path: {
      type: 'string',
      description: 'Absolute path to the .ipynb notebook file',
    },
    cell_id: {
      type: 'string',
      description: "Cell ID (UUID or 'cell-N' index). Required for replace/delete.",
    },
    new_source: {
      type: 'string',
      description: 'New cell content. Required for replace/insert.',
    },
    cell_type: {
      type: 'string',
      enum: ['code', 'markdown'],
      description: 'Cell type for insert operations (default: code)',
    },
    edit_mode: {
      type: 'string',
      enum: ['replace', 'insert', 'delete'],
      description: 'Edit mode: replace, insert, or delete (default: replace)',
    },
  },
  required: ['notebook_path'],
} as const;
