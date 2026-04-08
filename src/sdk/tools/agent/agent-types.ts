/**
 * @module tools/agent/agent-types
 * Built-in agent type definitions.
 * @license MIT
 */

/** Definition of a built-in agent type. */
export interface AgentTypeDefinition {
  /** Display name of the agent type. */
  name: string;
  /** Description of the agent type's purpose. */
  description: string;
  /** Allowed tool names. If undefined, all tools are available. */
  tools?: string[];
  /** Optional model override for this agent type. */
  model?: string;
}

/**
 * Built-in agent types supported by the SDK.
 *
 * - 'general-purpose': all tools, default agent
 * - 'Explore': read-only tools, for codebase exploration
 * - 'Plan': read-only tools, for architecture planning
 */
export const BUILT_IN_AGENT_TYPES: Record<string, AgentTypeDefinition> = {
  'general-purpose': {
    name: 'general-purpose',
    description: 'Default agent with access to all tools.',
  },
  Explore: {
    name: 'Explore',
    description:
      'Read-only agent for codebase exploration. ' +
      'Has access to Glob, Grep, Read, WebFetch, and WebSearch.',
    tools: ['Glob', 'Grep', 'Read', 'WebFetch', 'WebSearch'],
  },
  Plan: {
    name: 'Plan',
    description:
      'Read-only agent for architecture planning. ' +
      'Has access to Glob, Grep, Read, WebFetch, and WebSearch.',
    tools: ['Glob', 'Grep', 'Read', 'WebFetch', 'WebSearch'],
  },
};

/** Resolve agent type definition by name (case-sensitive). */
export function resolveAgentType(name: string): AgentTypeDefinition | undefined {
  return BUILT_IN_AGENT_TYPES[name];
}
