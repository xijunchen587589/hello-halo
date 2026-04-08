/**
 * @module tools/skill/discovery
 * Skill discovery from filesystem.
 * @license MIT
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A discovered skill loaded from a markdown file. */
export interface DiscoveredSkill {
  /** Skill name (from `name:` frontmatter or file stem). */
  name: string;
  /** One-line description (from `description:` frontmatter or default). */
  description: string;
  /** The prompt body after stripping frontmatter. */
  template: string;
  /** Absolute path to the source .md file. */
  sourcePath: string;
}

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

/** Parse a skill markdown file into a DiscoveredSkill. */
export function parseSkillFile(
  content: string,
  filePath: string,
): DiscoveredSkill | null {
  const trimmed = content.trim();
  if (!trimmed) return null;

  let name: string | undefined;
  let description: string | undefined;
  let template: string;

  if (trimmed.startsWith('---')) {
    const afterOpen = trimmed.slice(3);
    const closePos = afterOpen.indexOf('\n---');
    if (closePos !== -1) {
      const frontmatter = afterOpen.slice(0, closePos);
      const rest = afterOpen.slice(closePos + 4).replace(/^\n+/, '');

      for (const line of frontmatter.split('\n')) {
        const t = line.trim();
        if (t.startsWith('name:')) {
          name = t.slice(5).trim().replace(/^["']|["']$/g, '');
        } else if (t.startsWith('description:')) {
          description = t.slice(12).trim().replace(/^["']|["']$/g, '');
        }
      }

      template = rest;
    } else {
      // Malformed frontmatter — treat entire content as template
      template = trimmed;
    }
  } else {
    template = trimmed;
  }

  const resolvedName =
    name ||
    path.basename(filePath, path.extname(filePath)) ||
    'unnamed';
  const resolvedDescription = description || 'Custom skill';

  if (!template && !resolvedName) return null;

  return {
    name: resolvedName,
    description: resolvedDescription,
    template,
    sourcePath: filePath,
  };
}

// ---------------------------------------------------------------------------
// Directory scanning
// ---------------------------------------------------------------------------

/** Scan a directory for *.md skill files (synchronous). */
function scanDir(dir: string): DiscoveredSkill[] {
  const skills: DiscoveredSkill[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const filePath = path.join(dir, entry.name);
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const skill = parseSkillFile(content, filePath);
          if (skill) skills.push(skill);
        } catch {
          // Skip unreadable files
        }
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }
  return skills;
}

// ---------------------------------------------------------------------------
// Top-level discovery
// ---------------------------------------------------------------------------

export interface SkillsConfig {
  /** Additional filesystem paths to search. */
  paths: string[];
  /** Git URLs to clone and search. */
  urls: string[];
}

/**
 * Discover all skills from all configured sources.
 *
 * Search priority (first match wins for a given skill name):
 *   1. Project `.claude/skills/` — walk up from cwd
 *   2. Global `~/.claude/skills/`
 *   3. Configured extra paths
 *
 * Returns a Map of skill_name → DiscoveredSkill.
 */
export function discoverSkills(
  cwd: string,
  config?: Partial<SkillsConfig>,
): Map<string, DiscoveredSkill> {
  const all = new Map<string, DiscoveredSkill>();

  const add = (skills: DiscoveredSkill[]) => {
    for (const skill of skills) {
      if (!all.has(skill.name)) {
        all.set(skill.name, skill);
      }
    }
  };

  // 1. Project skills: walk up from cwd
  let dir = cwd;
  while (true) {
    add(scanDir(path.join(dir, '.claude', 'skills')));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // 2. Global skills: ~/.claude/skills/
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  if (homeDir) {
    add(scanDir(path.join(homeDir, '.claude', 'skills')));
  }

  // 3. Configured extra paths
  if (config?.paths) {
    for (const p of config.paths) {
      const absPath = path.isAbsolute(p) ? p : path.join(cwd, p);
      add(scanDir(absPath));
    }
  }

  return all;
}
