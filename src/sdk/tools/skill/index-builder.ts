/**
 * @module tools/skill/index-builder
 * Background skill index — builds and maintains a searchable index of all
 * available skills (bundled + filesystem).
 * @license MIT
 */

import { BUNDLED_SKILLS } from './bundled.js';
import { discoverSkills, type SkillsConfig } from './discovery.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single skill definition in the index. */
export interface SkillDefinition {
  name: string;
  description: string;
  tags: string[];
  /** Source: "bundled" | "user" */
  source: string;
  /** Path to the skill file on disk (null for bundled). */
  path: string | null;
}

// ---------------------------------------------------------------------------
// SkillIndex
// ---------------------------------------------------------------------------

/** In-memory skill search index. */
export class SkillIndex {
  private skills = new Map<string, SkillDefinition>();

  /** Add a skill to the index. */
  insert(skill: SkillDefinition): void {
    this.skills.set(skill.name.toLowerCase(), skill);
  }

  /** Query by partial name or tag match (case-insensitive). */
  search(query: string): SkillDefinition[] {
    const q = query.toLowerCase();
    return Array.from(this.skills.values()).filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }

  /** Return all skills. */
  all(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  get isEmpty(): boolean {
    return this.skills.size === 0;
  }

  get size(): number {
    return this.skills.size;
  }
}

// ---------------------------------------------------------------------------
// Prefetch
// ---------------------------------------------------------------------------

/**
 * Build a SkillIndex from bundled skills and discovered skills on disk.
 * Designed to be called in the background at session start.
 */
export function buildSkillIndex(
  cwd: string,
  config?: Partial<SkillsConfig>,
): SkillIndex {
  const index = new SkillIndex();

  // 1. Add bundled skills
  for (const skill of BUNDLED_SKILLS) {
    if (skill.userInvocable) {
      index.insert({
        name: skill.name,
        description: skill.description,
        tags: [],
        source: 'bundled',
        path: null,
      });
    }
  }

  // 2. Add discovered (user-defined) skills
  const discovered = discoverSkills(cwd, config);
  for (const [, skill] of discovered) {
    // Don't overwrite bundled skills with same name
    const existing = index.search(skill.name);
    if (!existing.some((s) => s.name.toLowerCase() === skill.name.toLowerCase())) {
      index.insert({
        name: skill.name,
        description: skill.description,
        tags: [],
        source: 'user',
        path: skill.sourcePath,
      });
    }
  }

  return index;
}

/**
 * Format a skill listing attachment for injection into the conversation.
 * Returns an empty string if no skills are available.
 */
export function formatSkillListing(index: SkillIndex): string {
  if (index.isEmpty) return '';

  const skills = index.all().sort((a, b) => a.name.localeCompare(b.name));
  let out = 'Available skills:\n';
  for (const skill of skills) {
    const tags = skill.tags.length > 0 ? ` [${skill.tags.join(', ')}]` : '';
    out += `  /${skill.name} — ${skill.description}${tags}\n`;
  }
  return out;
}
