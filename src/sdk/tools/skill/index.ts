/**
 * @module tools/skill
 * SkillTool — execute user-defined skill (prompt template) files.
 * @license MIT
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Tool, ToolContext, ToolResult } from '../../types/tool.js';
import { toolSuccess, toolError } from '../../types/tool.js';
import { SKILL_TOOL_NAME, SKILL_TOOL_DESCRIPTION, SKILL_TOOL_INPUT_SCHEMA } from './schema.js';
import { findBundledSkill, expandPrompt, userInvocableSkills } from './bundled.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get skill search directories for the current context. */
function skillSearchDirs(ctx: ToolContext): string[] {
  const dirs: string[] = [
    path.join(ctx.cwd, '.claude', 'commands'),
  ];
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  if (homeDir) {
    dirs.push(path.join(homeDir, '.claude', 'commands'));
  }
  return dirs;
}

/** Strip YAML frontmatter delimited by `---` at the start of the file. */
function stripFrontmatter(content: string): string {
  if (content.startsWith('---')) {
    const afterOpen = content.slice(3);
    const closePos = afterOpen.indexOf('\n---');
    if (closePos !== -1) {
      return afterOpen.slice(closePos + 4).replace(/^\n+/, '');
    }
  }
  return content;
}

/** Find and read a skill file from the search directories. */
function findAndReadSkill(name: string, dirs: string[]): string | null {
  for (const dir of dirs) {
    const filePath = path.join(dir, `${name}.md`);
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch {
      // Continue searching
    }
  }
  return null;
}

/** Read first non-empty, non-heading line as description. */
function readSkillDescription(filePath: string): string {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const body = stripFrontmatter(content);
    for (const line of body.split('\n')) {
      const t = line.trim().replace(/^#+\s*/, '');
      if (t) {
        return t.length > 80 ? t.slice(0, 80) : t;
      }
    }
  } catch {
    // Can't read file
  }
  return '(no description)';
}

/** List all available skills. */
function listSkills(dirs: string[]): ToolResult {
  const lines: string[] = [];

  // Bundled skills
  const bundled = userInvocableSkills();
  for (const [name, desc] of bundled) {
    lines.push(`  ${name} — ${desc} [bundled]`);
  }
  const bundledNames = new Set(bundled.map(([n]) => n));

  // Disk skills
  const diskSkills: Array<[string, string]> = [];
  const seenNames = new Set<string>();

  for (const dir of dirs) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          const stem = path.basename(entry.name, '.md');
          if (!seenNames.has(stem) && !bundledNames.has(stem)) {
            seenNames.add(stem);
            const filePath = path.join(dir, entry.name);
            const desc = readSkillDescription(filePath);
            diskSkills.push([stem, desc]);
          }
        }
      }
    } catch {
      // Directory doesn't exist
    }
  }

  diskSkills.sort(([a], [b]) => a.localeCompare(b));
  for (const [name, desc] of diskSkills) {
    lines.push(`  ${name} — ${desc}`);
  }

  const total = bundled.length + diskSkills.length;
  if (total === 0) {
    return toolSuccess(
      'No skills found. Create .md files in .claude/commands/ to define skills.\n' +
        'Example: .claude/commands/review.md',
    );
  }

  return toolSuccess(`Available skills (${total}):\n${lines.join('\n')}`);
}

// ---------------------------------------------------------------------------
// SkillTool
// ---------------------------------------------------------------------------

export const SkillTool: Tool = {
  name: SKILL_TOOL_NAME,
  description: SKILL_TOOL_DESCRIPTION,
  inputSchema: SKILL_TOOL_INPUT_SCHEMA as unknown as Record<string, unknown>,
  permissionLevel: 'none',

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const skillName = input.skill as string | undefined;
    const args = (input.args as string | undefined) ?? '';

    if (!skillName || typeof skillName !== 'string') {
      return toolError('Missing required parameter: skill');
    }

    const dirs = skillSearchDirs(ctx);

    // List mode
    if (skillName === 'list') {
      return listSkills(dirs);
    }

    const name = skillName.replace(/\.md$/, '');

    // Check bundled skills first — they take precedence
    const bundled = findBundledSkill(name);
    if (bundled) {
      const prompt = expandPrompt(bundled, args).trim();
      if (!prompt) {
        return toolError(`Bundled skill '${name}' expanded to empty content.`);
      }
      return toolSuccess(prompt);
    }

    // Check disk skills
    const raw = findAndReadSkill(name, dirs);
    if (!raw) {
      return toolError(
        `Skill '${name}' not found. Use skill="list" to see available skills.`,
      );
    }

    // Strip frontmatter and substitute $ARGUMENTS
    const content = stripFrontmatter(raw);
    const prompt = content.replace(/\$ARGUMENTS/g, args).trim();

    if (!prompt) {
      return toolError(`Skill '${name}' expanded to empty content.`);
    }

    return toolSuccess(prompt);
  },
};
