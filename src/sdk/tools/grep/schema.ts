/**
 * @module tools/grep/schema
 * Grep tool description and input schema.
 * @license MIT
 */

export const name = 'Grep';

export const description =
  'A powerful search tool built on regex. Supports full regex syntax. ' +
  'Filter files with the `glob` parameter or `type` parameter. Output ' +
  'modes: "content" shows matching lines, "files_with_matches" shows ' +
  'only file paths (default), "count" shows match counts.';

export const inputSchema = {
  type: 'object',
  properties: {
    pattern: {
      type: 'string',
      description: 'The regular expression pattern to search for',
    },
    path: {
      type: 'string',
      description: 'File or directory to search in. Defaults to working directory.',
    },
    type: {
      type: 'string',
      description: 'File type to search (e.g. js, py, rust, go)',
    },
    glob: {
      type: 'string',
      description: 'Glob pattern to filter files (e.g. "*.js")',
    },
    output_mode: {
      type: 'string',
      enum: ['content', 'files_with_matches', 'count'],
      description: 'Output mode (default: files_with_matches)',
    },
    context: {
      type: 'number',
      description: 'Number of context lines before and after each match',
    },
    '-i': {
      type: 'boolean',
      description: 'Case insensitive search',
    },
    '-n': {
      type: 'boolean',
      description: 'Show line numbers (for content mode)',
    },
    head_limit: {
      type: 'number',
      description: 'Limit output to first N entries (default 250)',
    },
    multiline: {
      type: 'boolean',
      description: 'Enable multiline mode where . matches newlines',
    },
  },
  required: ['pattern'],
} as const;
