/**
 * @module tools/skill/bundled
 * Built-in skill definitions.
 * @license MIT
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BundledSkill {
  /** Primary name used to invoke the skill (e.g. "simplify"). */
  name: string;
  /** One-line description shown in /skill list output and to the model. */
  description: string;
  /** Additional names that map to this skill. */
  aliases: string[];
  /** Optional guidance for the model about when to auto-invoke. */
  whenToUse?: string;
  /** Placeholder shown next to the skill name in help text. */
  argumentHint?: string;
  /** The prompt template. $ARGUMENTS is replaced at call time. */
  promptTemplate: string;
  /** If set, only these tool names are available during the skill run. */
  allowedTools?: string[];
  /** Whether a human user can invoke this skill via /skill <name>. */
  userInvocable: boolean;
}

// ---------------------------------------------------------------------------
// Bundled skills
// ---------------------------------------------------------------------------

export const BUNDLED_SKILLS: BundledSkill[] = [
  // simplify
  {
    name: 'simplify',
    description: 'Review changed code for reuse, quality, and efficiency, then fix any issues found.',
    aliases: [],
    whenToUse: 'After writing code, when you want a quality review and cleanup pass.',
    promptTemplate: `# Simplify: Code Review and Cleanup

Review all changed files for reuse, quality, and efficiency. Fix any issues found.

## Phase 1: Identify Changes

Run \`git diff\` (or \`git diff HEAD\` if there are staged changes) to see what changed.
If there are no git changes, review the most recently modified files that were
mentioned or edited earlier in this conversation.

## Phase 2: Launch Three Review Agents in Parallel

Use the Agent tool to launch all three agents concurrently in a single message.
Pass each agent the full diff so it has complete context.

### Agent 1: Code Reuse Review

For each change:
1. **Search for existing utilities and helpers** that could replace newly written code.
2. **Flag any new function that duplicates existing functionality.**
3. **Flag any inline logic that could use an existing utility** — hand-rolled string
   manipulation, manual path handling, custom environment checks, etc.

### Agent 2: Code Quality Review

Review the same changes for hacky patterns:
1. **Redundant state** that duplicates existing state.
2. **Parameter sprawl** — new parameters instead of restructuring.
3. **Copy-paste with slight variation** that should be unified.
4. **Leaky abstractions** — exposing internal details.
5. **Stringly-typed code** where constants or enums already exist.
6. **Unnecessary comments** narrating what code does (not why).

### Agent 3: Efficiency Review

Review the same changes for efficiency:
1. **Unnecessary work** — redundant computations, duplicate reads.
2. **Missed concurrency** — independent operations run sequentially.
3. **Hot-path bloat** — blocking work added to startup or per-request paths.
4. **Recurring no-op updates** — unconditional updates in polling loops.
5. **Memory** — unbounded data structures, missing cleanup.

## Phase 3: Fix Issues

Wait for all three agents to complete. Aggregate findings and fix each issue.
If a finding is a false positive, note it and move on.

When done, briefly summarize what was fixed (or confirm the code was already clean).
$ARGUMENTS_SUFFIX`,
    userInvocable: true,
  },

  // remember
  {
    name: 'remember',
    description: 'Review auto-memory entries and propose promotions to AGENTS.md, AGENTS.local.md, or shared memory.',
    aliases: ['mem', 'save'],
    whenToUse: 'When the user wants to review, organise, or promote their auto-memory entries.',
    argumentHint: '[additional context]',
    promptTemplate: `# Memory Review

## Goal
Review the user's memory landscape and produce a clear report of proposed changes,
grouped by action type. Do NOT apply changes — present proposals for user approval.

## Steps

### 1. Gather all memory layers
Read AGENTS.md and AGENTS.local.md from the project root (if they exist).
Your auto-memory content is already in your system prompt — review it there.

### 2. Classify each auto-memory entry

| Destination | What belongs there |
|---|---|
| **AGENTS.md** | Project conventions all contributors should follow |
| **AGENTS.local.md** | Personal instructions specific to this user |
| **Stay in auto-memory** | Working notes, temporary context, uncertain patterns |

### 3. Identify cleanup opportunities
- **Duplicates**: auto-memory entries already in AGENTS.md → propose removing
- **Outdated**: AGENTS.md entries contradicted by newer auto-memory → propose updating
- **Conflicts**: contradictions between layers → propose resolution

### 4. Present the report
Output a structured report grouped by: Promotions, Cleanup, Ambiguous, No action needed.

## Rules
- Present ALL proposals before making any changes
- Do NOT modify files without explicit user approval
- Ask about ambiguous entries — don't guess
$ARGUMENTS_SUFFIX`,
    allowedTools: ['Read', 'Write', 'Edit', 'Glob'],
    userInvocable: true,
  },

  // debug
  {
    name: 'debug',
    description: 'Enable debug logging for this session and help diagnose issues.',
    aliases: ['diagnose'],
    whenToUse: 'When there is an error, bug, or unexpected behaviour to investigate.',
    argumentHint: '[issue description or error message]',
    promptTemplate: `# Debug Skill

Help the user debug an issue they are encountering.

## Issue Description

$ARGUMENTS

## Systematic Debugging Approach

1. **Reproduce** — Confirm the exact error / behaviour.
2. **Locate** — Find the relevant code (read files, grep for error messages).
3. **Hypothesize** — Form 2–3 hypotheses about the root cause.
4. **Test** — Verify each hypothesis systematically.
5. **Fix** — Implement the fix for the confirmed root cause.
6. **Verify** — Confirm the fix resolves the issue.

## Settings Reference

Settings files are in:
- User:    ~/.claude/settings.json
- Project: .claude/settings.json
- Local:   .claude/settings.local.json

Read the relevant files before making any changes.`,
    allowedTools: ['Read', 'Grep', 'Glob'],
    userInvocable: true,
  },

  // stuck
  {
    name: 'stuck',
    description: "Help get unstuck when you don't know how to proceed.",
    aliases: ['help-me', 'unblock'],
    whenToUse: 'When you are stuck, confused, or don\'t know how to proceed.',
    argumentHint: "[what you're trying to do]",
    promptTemplate: `The user is stuck$ARGUMENTS_SUFFIX. Help them get unstuck:

1. Clarify what they are trying to achieve (if unclear).
2. Identify why they might be stuck (missing context, unclear requirements, technical blocker).
3. Suggest 2–3 concrete next steps in order of likelihood of success.
4. If a technical blocker: propose specific debugging steps or workarounds.
5. Ask clarifying questions if needed.

Be direct and actionable. Focus on unblocking, not on explaining concepts.`,
    userInvocable: true,
  },

  // batch
  {
    name: 'batch',
    description: 'Research and plan a large-scale change, then execute it in parallel across isolated worktree agents that each open a PR.',
    aliases: [],
    whenToUse: 'When the user wants to make a sweeping, mechanical change across many files that can be decomposed into independent parallel units.',
    argumentHint: '<instruction>',
    promptTemplate: `# Batch: Parallel Work Orchestration

You are orchestrating a large, parallelisable change across this codebase.

## User Instruction

$ARGUMENTS

## Phase 1: Research and Plan (Plan Mode)

Enter plan mode, then:

1. **Understand the scope.** Launch subagents to deeply research what this instruction
   touches. Find all files, patterns, and call sites that need to change.

2. **Decompose into independent units.** Break the work into 5–30 self-contained units.
   Each unit must be independently implementable in an isolated git worktree and
   mergeable on its own without depending on another unit's PR landing first.

3. **Determine the e2e test recipe.** Figure out how a worker can verify its change
   actually works end-to-end. If you cannot find a concrete path, ask the user.

4. **Write the plan.** Include: research summary, numbered work units, e2e recipe,
   and the exact worker instructions.

## Phase 2: Spawn Workers (After Plan Approval)

Spawn one background agent per work unit using the Agent tool with
\`isolation: "worktree"\` and \`run_in_background: true\`. Launch them all in a single
message block so they run in parallel. Each agent prompt must be fully self-contained.

After each agent finishes, parse the \`PR: <url>\` line from its result and render
a status table. When all agents have reported, print a final summary.`,
    userInvocable: true,
  },

  // verify
  {
    name: 'verify',
    description: 'Verify that code or behaviour is correct.',
    aliases: ['check', 'validate'],
    whenToUse: 'After implementing something, to verify it is correct.',
    argumentHint: '[what to verify]',
    promptTemplate: `# Verify: $ARGUMENTS

## Verification Steps

1. Read the relevant code / implementation.
2. Check against requirements (if specified).
3. Look for edge cases and error conditions.
4. Run tests if available.
5. Check for common pitfalls: null handling, error propagation, type safety.
6. Report: what was verified, what passed, what failed or is uncertain.`,
    userInvocable: true,
  },

  // update-config
  {
    name: 'update-config',
    description: 'Configure settings (hooks, permissions, env vars, behaviours) via settings.json.',
    aliases: ['config-update', 'settings'],
    whenToUse: 'When the user wants to configure automated behaviours, permissions, or settings.',
    argumentHint: '<what to configure>',
    promptTemplate: `# Update Config Skill

Modify configuration by updating settings.json files.

## Settings File Locations

| File | Scope | Use For |
|------|-------|---------|
| \`~/.claude/settings.json\` | Global | Personal preferences for all projects |
| \`.claude/settings.json\` | Project | Team-wide hooks, permissions, plugins |
| \`.claude/settings.local.json\` | Project (local) | Personal overrides for this project |

Settings load in order: user → project → local (later overrides earlier).

## CRITICAL: Read Before Write

Always read the existing settings file before making changes.
Merge new settings with existing ones — never replace the entire file.

## Hook Events

PreToolUse, PostToolUse, PreCompact, PostCompact, Stop, Notification, SessionStart

## User Request

$ARGUMENTS`,
    allowedTools: ['Read', 'Write', 'Edit', 'Bash'],
    userInvocable: true,
  },

  // claude-api
  {
    name: 'claude-api',
    description: 'Build apps with the Claude API or Anthropic SDK.',
    aliases: ['api', 'anthropic-sdk'],
    whenToUse: 'When the user wants to use the Claude API, Anthropic SDK, or build Claude-powered apps.',
    argumentHint: '[what to build]',
    promptTemplate: `# Build a Claude API Integration

## User Request

$ARGUMENTS

## Default Models

- Most capable: claude-opus-4-6
- Balanced:     claude-sonnet-4-6
- Fast:         claude-haiku-4-5-20251001

## SDK Quickstart

**Python**
\`\`\`python
pip install anthropic
import anthropic
client = anthropic.Anthropic()
\`\`\`

**TypeScript / Node**
\`\`\`typescript
npm install @anthropic-ai/sdk
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic();
\`\`\`

## Key API Features

- Streaming (\`stream_message\`)
- Tool use / function calling
- Extended thinking
- Prompt caching
- Vision (image input)
- Files API
- Batch processing

Use async/await patterns. Follow SDK best practices.`,
    allowedTools: ['Read', 'Grep', 'Glob', 'WebFetch'],
    userInvocable: true,
  },

  // loop
  {
    name: 'loop',
    description: 'Run a prompt or slash command on a recurring interval.',
    aliases: [],
    whenToUse: 'When the user wants to run something repeatedly on a schedule.',
    argumentHint: '[interval] <command>',
    promptTemplate: `# /loop — schedule a recurring prompt

Parse the input below into \`[interval] <prompt...>\` and schedule it with CronCreate.

## Parsing (in priority order)

1. **Leading token**: if the first token matches \`^\\d+[smhd]$\` (e.g. \`5m\`, \`2h\`), that
   is the interval; the rest is the prompt.
2. **Trailing "every" clause**: if the input ends with \`every <N><unit>\` extract that
   as the interval and strip it from the prompt.
3. **Default**: interval is \`10m\` and the entire input is the prompt.

If the resulting prompt is empty, show usage \`/loop [interval] <prompt>\` and stop.

## Interval → Cron

| Pattern | Cron | Notes |
|---------|------|-------|
| \`Nm\` (N ≤ 59) | \`*/N * * * *\` | every N minutes |
| \`Nh\` (N ≤ 23) | \`0 */N * * *\` | every N hours |
| \`Nd\` | \`0 0 */N * *\` | every N days at midnight |
| \`Ns\` | round up to nearest minute | cron min granularity is 1 min |

## Action

1. Call CronCreate with the parsed cron expression and prompt.
2. Confirm what was scheduled, including the cron expression and human-readable cadence.
3. **Immediately execute the parsed prompt now** — don't wait for the first cron fire.

## Input

$ARGUMENTS`,
    allowedTools: ['CronCreate', 'CronList'],
    userInvocable: true,
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Find a bundled skill by name or alias (case-insensitive). */
export function findBundledSkill(name: string): BundledSkill | undefined {
  const lower = name.toLowerCase();
  return BUNDLED_SKILLS.find(
    (s) =>
      s.name === lower || s.aliases.some((a) => a === lower),
  );
}

/** Return [name, description] pairs for all user-invocable bundled skills. */
export function userInvocableSkills(): Array<[string, string]> {
  return BUNDLED_SKILLS
    .filter((s) => s.userInvocable)
    .map((s) => [s.name, s.description]);
}

/**
 * Expand a skill's prompt template, substituting $ARGUMENTS and $ARGUMENTS_SUFFIX.
 *
 * - $ARGUMENTS        → replaced by `args` verbatim (or "" when empty)
 * - $ARGUMENTS_SUFFIX → replaced by ": <args>" when non-empty, else ""
 */
export function expandPrompt(skill: BundledSkill, args: string): string {
  const suffix = args ? `: ${args}` : '';
  return skill.promptTemplate
    .replace(/\$ARGUMENTS_SUFFIX/g, suffix)
    .replace(/\$ARGUMENTS/g, args);
}
