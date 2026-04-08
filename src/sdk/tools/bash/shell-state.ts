/**
 * @module tools/bash/shell-state
 * Persistent shell state management across Bash tool invocations.
 * Tracks cwd and env variables so `cd` and `export` persist across tool calls.
 * @license MIT
 */

import type { ShellState } from '../../types/tool.js';

/**
 * Manages shell state per session.
 * Each session has its own ShellState that persists cwd and env vars
 * across multiple Bash tool invocations.
 */
export class ShellStateManager {
  private states = new Map<string, ShellState>();

  /** Get or create the ShellState for a session. */
  get(sessionId: string, defaultCwd: string): ShellState {
    let state = this.states.get(sessionId);
    if (!state) {
      state = {
        cwd: defaultCwd,
        envVars: new Map(),
      };
      this.states.set(sessionId, state);
    }
    return state;
  }

  /** Update the ShellState for a session. */
  update(sessionId: string, state: ShellState): void {
    this.states.set(sessionId, state);
  }

  /** Remove state for a session (cleanup). */
  remove(sessionId: string): void {
    this.states.delete(sessionId);
  }
}

/** Global shell state manager singleton. */
export const shellStateManager = new ShellStateManager();

/**
 * Extract `export VAR=value` patterns from a command string.
 * Only handles simple single-line exports; complex shell constructs are
 * handled by the full env-dump approach.
 */
export function extractExportsFromCommand(command: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /^\s*export\s+([A-Za-z_][A-Za-z0-9_]*)=(?:"([^"]*)"|'([^']*)'|(\S*))/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(command)) !== null) {
    const key = match[1];
    const val = match[2] ?? match[3] ?? match[4] ?? '';
    map.set(key, val);
  }
  return map;
}
