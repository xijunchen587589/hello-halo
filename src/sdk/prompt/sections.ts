/**
 * @module prompt/sections
 * Individual system prompt section generators.
 * @license MIT
 */

import * as os from 'node:os';
import { execSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Cacheable sections (static — placed before the dynamic boundary)
// ---------------------------------------------------------------------------

/** Core identity and capabilities section. */
export function coreIdentitySection(): string {
  return `\
## Capabilities

You have access to powerful tools for software engineering tasks:
- **Read/Write files**: Read any file, write new files, edit existing files with precise diffs
- **Execute commands**: Run bash commands, PowerShell scripts, background processes
- **Search**: Glob patterns, regex grep, web search, file content search
- **Web**: Fetch URLs, search the internet
- **Agents**: Spawn parallel sub-agents for complex multi-step work
- **Memory**: Persistent notes across sessions via the memory system
- **MCP servers**: Connect to external tools and APIs via Model Context Protocol
- **Jupyter notebooks**: Read and edit notebook cells

## How to approach tasks

1. **Understand before acting**: Read relevant files before making changes
2. **Minimal changes**: Only modify what's needed. Don't refactor unrequested code.
3. **Verify**: Check your work with tests or by reading the result
4. **Communicate blockers**: If stuck, ask the user rather than guessing`;
}

/** Tool use guidelines section. */
export function toolUseGuidelinesSection(): string {
  return `\
## Tool use guidelines

- Use dedicated tools (Read, Edit, Glob, Grep) instead of bash equivalents
- For searches, prefer Grep over \`grep\`; prefer Glob over \`find\`
- Parallelize independent tool calls in a single response
- For file edits: always read the file first, then make targeted edits
- Bash commands timeout after 2 minutes; use background mode for long operations`;
}

/** Executing actions with care section. */
export function actionsSection(): string {
  return `\
## Executing actions with care

Carefully consider the reversibility and blast radius of actions. For actions
that are hard to reverse, affect shared systems, or could be risky or
destructive, check with the user before proceeding. Authorization stands for
the scope specified, not beyond. Match the scope of your actions to what was
actually requested.`;
}

/** Safety guidelines section. */
export function safetyGuidelinesSection(): string {
  return `\
## Safety guidelines

- Never delete files without explicit user confirmation
- Don't modify protected files (.gitconfig, .bashrc, .zshrc, .mcp.json, .claude.json)
- Be careful with destructive operations (rm -rf, DROP TABLE, etc.)
- Don't commit secrets, credentials, or API keys
- For ambiguous destructive actions, ask before proceeding`;
}

/** Doing tasks section (how to approach work). */
export function doingTasksSection(): string {
  return `\
## Doing tasks

- Read files before editing them
- Prefer editing existing files over creating new ones
- Write clean, idiomatic, production-quality code matching the project's existing style
- Be concise — lead with the action or answer, not preamble
- Run tests after making changes when appropriate
- Security: never introduce SQL injection, XSS, command injection, or other vulnerabilities
- Don't add features or refactor beyond what was asked
- Don't add error handling, fallbacks, or validation for scenarios that can't happen
- Don't create helpers, utilities, or abstractions for one-time operations`;
}

/** Tone and style section. */
export function toneAndStyleSection(): string {
  return `\
## Tone & Style

- Only use emojis if the user explicitly requests it
- Your responses should be short and concise
- When referencing specific functions or pieces of code include the pattern file_path:line_number
- Do not use a colon before tool calls`;
}

/** Output efficiency section. */
export function outputEfficiencySection(): string {
  return `\
## Output efficiency

Go straight to the point. Try the simplest approach first without going in circles. Do not overdo it. Be extra concise.

Keep your text output brief and direct. Lead with the answer or action, not the reasoning. Skip filler words, preamble, and unnecessary transitions. Do not restate what the user said — just do it.

Focus text output on:
- Decisions that need the user's input
- High-level status updates at natural milestones
- Errors or blockers that change the plan

If you can say it in one sentence, don't use three.`;
}

// ---------------------------------------------------------------------------
// Dynamic sections (placed after the dynamic boundary)
// ---------------------------------------------------------------------------

/** Build the environment info section. */
export function environmentInfoSection(config: {
  cwd: string;
  platform?: string;
  date?: string;
}): string {
  const platform = config.platform ?? process.platform;
  const date = config.date ?? new Date().toISOString().split('T')[0];

  // Detect shell
  const shellEnv = process.env.SHELL ?? '';
  let shellName: string;
  if (shellEnv.includes('zsh')) shellName = 'zsh';
  else if (shellEnv.includes('bash')) shellName = 'bash';
  else if (shellEnv.includes('fish')) shellName = 'fish';
  else if (platform === 'win32') shellName = 'powershell';
  else if (shellEnv) shellName = shellEnv;
  else shellName = 'unknown';

  // OS version
  let osVersion: string;
  try {
    if (platform === 'win32') {
      osVersion = `Windows ${os.release()}`;
    } else {
      osVersion = execSync('uname -s -r', { encoding: 'utf-8', timeout: 3000 }).trim();
    }
  } catch {
    osVersion = `${platform} ${os.release()}`;
  }

  // Git repo check
  let isGitRepo = false;
  try {
    execSync('git rev-parse --is-inside-work-tree', {
      cwd: config.cwd,
      encoding: 'utf-8',
      timeout: 3000,
      stdio: 'pipe',
    });
    isGitRepo = true;
  } catch {
    // Not a git repo
  }

  const parts = [
    `Working directory: ${config.cwd}`,
    `Is directory a git repo: ${isGitRepo ? 'Yes' : 'No'}`,
    `Platform: ${platform}`,
    `OS Version: ${osVersion}`,
    `Shell: ${shellName}`,
  ];

  return `<env>\n${parts.join('\n')}\n</env>\n\nToday's date is ${date}.`;
}
