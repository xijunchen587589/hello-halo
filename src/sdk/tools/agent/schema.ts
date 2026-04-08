/**
 * @module tools/agent/schema
 * Agent tool schema and configuration.
 * @license MIT
 */

export const AGENT_TOOL_NAME = 'Agent';

export const AGENT_TOOL_DESCRIPTION =
  'Launch a new agent to handle complex, multi-step tasks autonomously. ' +
  'The agent runs its own agentic loop with access to tools and returns ' +
  'its final result. Use this to delegate sub-tasks, run parallel ' +
  'workstreams, or handle tasks that require many tool calls.';

export const AGENT_TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    description: {
      type: 'string',
      description: "Short description of the agent's task (3-5 words)",
    },
    prompt: {
      type: 'string',
      description: 'The complete task for the agent to perform',
    },
    tools: {
      type: 'array',
      items: { type: 'string' },
      description: 'List of tool names to make available. Defaults to all tools.',
    },
    system_prompt: {
      type: 'string',
      description: 'Optional system prompt override for the sub-agent',
    },
    max_turns: {
      type: 'number',
      description: 'Maximum number of turns for the sub-agent (default 10)',
    },
    model: {
      type: 'string',
      description: 'Optional model to use for this agent',
    },
    isolation: {
      type: 'string',
      enum: ['worktree'],
      description:
        'Set to "worktree" to run the agent in an isolated git worktree. ' +
        'Prevents file-edit conflicts when multiple agents run in parallel.',
    },
    run_in_background: {
      type: 'boolean',
      description:
        'If true, the agent starts immediately and this call returns an ' +
        'agent_id without waiting for completion. Poll with poll_background_agent ' +
        'to retrieve the result. Default: false.',
    },
  },
  required: ['description', 'prompt'],
} as const;
