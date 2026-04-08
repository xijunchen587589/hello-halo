/**
 * @module tools/write/schema
 * File Write tool description and input schema.
 * @license MIT
 */

export const name = 'Write';

export const description =
  'Writes a file to the local filesystem. This tool will overwrite the existing ' +
  'file if there is one. Prefer the Edit tool for modifying existing files. ' +
  'Only use this tool to create new files or for complete rewrites.';

export const inputSchema = {
  type: 'object',
  properties: {
    file_path: {
      type: 'string',
      description: 'The absolute path to the file to write',
    },
    content: {
      type: 'string',
      description: 'The content to write to the file',
    },
  },
  required: ['file_path', 'content'],
} as const;
