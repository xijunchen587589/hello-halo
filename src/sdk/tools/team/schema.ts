/**
 * @module tools/team/schema
 * Team tool schemas and configuration.
 * @license MIT
 */

// ---------------------------------------------------------------------------
// TeamCreate
// ---------------------------------------------------------------------------

export const TEAM_CREATE_TOOL_NAME = 'TeamCreate';

export const TEAM_CREATE_DESCRIPTION =
  'Create a named team of agents that collectively work on a shared task. ' +
  'Each agent gets a restricted tool list and its own prompt. ' +
  'Agents run in parallel by default and their outputs are aggregated. ' +
  'Input: { team_name, task, agents: [{name, role?, tools?, task?}], parallel?, description? }';

export const TEAM_CREATE_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    team_name: {
      type: 'string',
      description: 'Name for the new team.',
    },
    task: {
      type: 'string',
      description: 'The shared task all agents should work on.',
    },
    agents: {
      type: 'array',
      description: 'Agent specifications. Each agent runs independently.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          role: { type: 'string', description: 'Role/persona description.' },
          tools: {
            type: 'array',
            items: { type: 'string' },
            description: 'Allowed tool names. Omit to use all tools.',
          },
          task: {
            type: 'string',
            description: 'Per-agent task override. Falls back to top-level task.',
          },
        },
        required: ['name'],
      },
    },
    parallel: {
      type: 'boolean',
      description: 'Run all agents in parallel (default: true). Set false for sequential.',
    },
    description: {
      type: 'string',
      description: 'Optional team description stored in config.',
    },
  },
  required: ['team_name', 'task'],
} as const;

// ---------------------------------------------------------------------------
// TeamDelete
// ---------------------------------------------------------------------------

export const TEAM_DELETE_TOOL_NAME = 'TeamDelete';

export const TEAM_DELETE_DESCRIPTION =
  'Cancel a running team and clean up its directories. ' +
  'Signals all in-flight agents to stop, then removes ' +
  '~/.claude/teams/{team_name}/.';

export const TEAM_DELETE_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    team_name: {
      type: 'string',
      description: 'Name of the team to delete.',
    },
  },
  required: ['team_name'],
} as const;
