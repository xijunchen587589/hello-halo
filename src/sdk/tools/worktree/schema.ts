/**
 * @module tools/worktree/schema
 * Worktree tools description and input schemas.
 * @license MIT
 */

// --- EnterWorktree ---

export const ENTER_WORKTREE_TOOL_NAME = 'EnterWorktree';

export const ENTER_WORKTREE_TOOL_DESCRIPTION =
  'Use this tool ONLY when the user explicitly asks to work in a worktree. ' +
  'This tool creates an isolated git worktree and switches the current session into it.\n\n' +
  '## When to Use\n\n' +
  '- The user explicitly says "worktree" (e.g., "start a worktree", "work in a worktree", ' +
  '"create a worktree", "use a worktree")\n\n' +
  '## When NOT to Use\n\n' +
  '- The user asks to create a branch, switch branches, or work on a different branch — use git commands instead\n' +
  '- The user asks to fix a bug or work on a feature — use normal git workflow unless they specifically mention worktrees\n' +
  '- Never use this tool unless the user explicitly mentions "worktree"\n\n' +
  '## Requirements\n\n' +
  '- Must be in a git repository, OR have WorktreeCreate/WorktreeRemove hooks configured in settings.json\n' +
  '- Must not already be in a worktree\n\n' +
  '## Behavior\n\n' +
  '- In a git repository: creates a new git worktree inside `.claude/worktrees/` with a new branch based on HEAD\n' +
  '- Outside a git repository: delegates to WorktreeCreate/WorktreeRemove hooks for VCS-agnostic isolation\n' +
  '- Switches the session\'s working directory to the new worktree\n' +
  '- Use ExitWorktree to leave the worktree mid-session (keep or remove). On session exit, if still in the worktree, the user will be prompted to keep or remove it\n\n' +
  '## Parameters\n\n' +
  '- `name` (optional): A name for the worktree. If not provided, a random name is generated.';

export const ENTER_WORKTREE_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description:
        'Optional name for the worktree. Each "/"-separated segment may contain only letters, ' +
        'digits, dots, underscores, and dashes; max 64 chars total. A random name is generated if not provided.',
    },
  },
} as const;

// --- ExitWorktree ---

export const EXIT_WORKTREE_TOOL_NAME = 'ExitWorktree';

export const EXIT_WORKTREE_TOOL_DESCRIPTION =
  'Exit a worktree session created by EnterWorktree and return the session to the original working directory.\n\n' +
  '## Scope\n\n' +
  'This tool ONLY operates on worktrees created by EnterWorktree in this session. It will NOT touch:\n' +
  '- Worktrees you created manually with `git worktree add`\n' +
  '- Worktrees from a previous session (even if created by EnterWorktree then)\n' +
  '- The directory you\'re in if EnterWorktree was never called\n\n' +
  'If called outside an EnterWorktree session, the tool is a **no-op**: it reports that no worktree session is active and takes no action. Filesystem state is unchanged.\n\n' +
  '## When to Use\n\n' +
  '- The user explicitly asks to "exit the worktree", "leave the worktree", "go back", or otherwise end the worktree session\n' +
  '- Do NOT call this proactively — only when the user asks\n\n' +
  '## Parameters\n\n' +
  '- `action` (required): `"keep"` or `"remove"`\n' +
  '  - `"keep"` — leave the worktree directory and branch intact on disk. Use this if the user wants to come back to the work later, or if there are changes to preserve.\n' +
  '  - `"remove"` — delete the worktree directory and its branch. Use this for a clean exit when the work is done or abandoned.\n' +
  '- `discard_changes` (optional, default false): only meaningful with `action: "remove"`. If the worktree has uncommitted files or commits not on the original branch, the tool will REFUSE to remove it unless this is set to `true`. If the tool returns an error listing changes, confirm with the user before re-invoking with `discard_changes: true`.\n\n' +
  '## Behavior\n\n' +
  '- Restores the session\'s working directory to where it was before EnterWorktree\n' +
  '- Clears CWD-dependent caches (system prompt sections, memory files, plans directory) so the session state reflects the original directory\n' +
  '- If a tmux session was attached to the worktree: killed on `remove`, left running on `keep` (its name is returned so the user can reattach)\n' +
  '- Once exited, EnterWorktree can be called again to create a fresh worktree';

export const EXIT_WORKTREE_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['keep', 'remove'],
      description: '"keep" leaves the worktree and branch on disk; "remove" deletes both.',
    },
    discard_changes: {
      type: 'boolean',
      description:
        'Required true when action is "remove" and the worktree has uncommitted files or unmerged commits. ' +
        'The tool will refuse and list them otherwise.',
    },
  },
  required: ['action'],
} as const;
