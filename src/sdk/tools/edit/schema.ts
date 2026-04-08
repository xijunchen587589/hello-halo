/**
 * @module tools/edit/schema
 * File Edit tool description and input schema.
 * @license MIT
 */

export const name = 'Edit';

export const description =
  'Performs exact string replacements in files. The edit will FAIL if ' +
  '`old_string` is not unique in the file (unless `replace_all` is true). ' +
  'You MUST read the file first before editing. Preserve the exact ' +
  'indentation as it appears in the file.';

export const inputSchema = {
  type: 'object',
  properties: {
    file_path: {
      type: 'string',
      description: 'The absolute path to the file to modify',
    },
    old_string: {
      type: 'string',
      description:
        'The text to replace (must be unique in the file unless replace_all is true)',
    },
    new_string: {
      type: 'string',
      description: 'The text to replace it with (must be different from old_string)',
    },
    replace_all: {
      type: 'boolean',
      description: 'Replace all occurrences of old_string (default false)',
    },
  },
  required: ['file_path', 'old_string', 'new_string'],
} as const;
