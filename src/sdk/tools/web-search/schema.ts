/**
 * @module tools/web-search/schema
 * WebSearch tool description and input schema.
 * @license MIT
 */

export const WEB_SEARCH_TOOL_NAME = 'WebSearch';

export const WEB_SEARCH_TOOL_DESCRIPTION =
  '- Allows Claude to search the web and use the results to inform responses\n' +
  '- Provides up-to-date information for current events and recent data\n' +
  '- Returns search result information formatted as search result blocks, including links as markdown hyperlinks\n' +
  '- Use this tool for accessing information beyond Claude\'s knowledge cutoff\n' +
  '- Searches are performed automatically within a single API call\n\n' +
  'CRITICAL REQUIREMENT - You MUST follow this:\n' +
  '  - After answering the user\'s question, you MUST include a "Sources:" section at the end of your response\n' +
  '  - In the Sources section, list all relevant URLs from the search results as markdown hyperlinks: [Title](URL)\n' +
  '  - This is MANDATORY - never skip including sources in your response\n' +
  '  - Example format:\n\n' +
  '    [Your answer here]\n\n' +
  '    Sources:\n' +
  '    - [Source Title 1](https://example.com/1)\n' +
  '    - [Source Title 2](https://example.com/2)\n\n' +
  'Usage notes:\n' +
  '  - Domain filtering is supported to include or block specific websites\n' +
  '  - Web search is only available in the US';

export const WEB_SEARCH_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'The search query to use',
      minLength: 2,
    },
    allowed_domains: {
      type: 'array',
      items: { type: 'string' },
      description: 'Only include search results from these domains',
    },
    blocked_domains: {
      type: 'array',
      items: { type: 'string' },
      description: 'Never include search results from these domains',
    },
  },
  required: ['query'],
} as const;
