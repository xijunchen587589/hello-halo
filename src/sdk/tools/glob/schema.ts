/**
 * @module tools/glob/schema
 * Glob tool description and input schema.
 * @license MIT
 */

export const name = 'Glob';

export const description =
  'Fast file pattern matching tool that works with any codebase size. ' +
  'Supports glob patterns like "**/*.rs" or "src/**/*.ts". Returns ' +
  'matching file paths sorted by modification time. Use this tool when ' +
  'you need to find files by name patterns.';

export const inputSchema = {
  type: 'object',
  properties: {
    pattern: {
      type: 'string',
      description: 'The glob pattern to match files against',
    },
    path: {
      type: 'string',
      description: 'The directory to search in. Defaults to working directory.',
    },
  },
  required: ['pattern'],
} as const;
