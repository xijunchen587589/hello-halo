/**
 * @module tools/skill/schema
 * Skill tool schema and configuration.
 * @license MIT
 */

export const SKILL_TOOL_NAME = 'Skill';

export const SKILL_TOOL_DESCRIPTION =
  'Execute a skill (custom prompt template) by name. ' +
  'Skills are .md files in .claude/commands/ or ~/.claude/commands/. ' +
  'Use skill="list" to discover available skills. ' +
  'The expanded skill prompt is returned for you to act on.';

export const SKILL_TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    skill: {
      type: 'string',
      description:
        'Skill name (without .md extension), or "list" to enumerate skills',
    },
    args: {
      type: 'string',
      description:
        'Arguments passed to the skill — replaces $ARGUMENTS in the template',
    },
  },
  required: ['skill'],
} as const;
