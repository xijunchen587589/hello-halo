/**
 * @module tools/bash/wrapper
 * Shell wrapper script generation and sentinel parsing.
 * Wraps user commands to capture exit code, final cwd, and env vars.
 * @license MIT
 */

import type { ShellState } from '../../types/tool.js';

/** Sentinel marker separating user output from shell state metadata. */
export const SHELL_STATE_SENTINEL = '__CC_SHELL_STATE__';

/** System/internal env vars that should not be persisted. */
const FILTERED_VARS = new Set([
  '_', 'SHLVL', 'BASH_LINENO', 'BASH_SOURCE',
  'FUNCNAME', 'PIPESTATUS', 'OLDPWD',
]);

/**
 * Build a bash wrapper script that:
 * 1. Restores saved cwd and env vars
 * 2. Runs the user command
 * 3. Prints sentinel + final pwd + env dump for state persistence
 */
export function buildWrapperScript(command: string, state: ShellState): string {
  // Escape for single-quote embedding
  const cwdEscaped = state.cwd.replace(/'/g, "'\\''");

  // Build export lines for persisted env vars
  let exportLines = '';
  for (const [k, v] of state.envVars) {
    const vEscaped = v.replace(/'/g, "'\\''");
    exportLines += `export ${k}='${vEscaped}'\n`;
  }

  return `set -e
cd '${cwdEscaped}'
${exportLines}set +e
${command}
__CC_EXIT_CODE=$?
echo '${SHELL_STATE_SENTINEL}'
pwd
env | grep -E '^[A-Za-z_][A-Za-z0-9_]*=' || true
exit $__CC_EXIT_CODE
`;
}

/**
 * Parse the shell state block from stdout lines.
 * Returns the new cwd and env var delta, or null if parsing fails.
 *
 * The block format after the sentinel:
 * ```
 * /some/path          <- final cwd (first line)
 * KEY=value           <- exported env vars (remaining lines)
 * ```
 */
export function parseShellStateBlock(
  lines: string[],
): { cwd: string; envVars: Map<string, string> } | null {
  if (lines.length === 0) return null;

  const cwd = lines[0].trim();
  if (!cwd) return null;

  const envVars = new Map<string, string>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = line.slice(0, eqIdx);
    const val = line.slice(eqIdx + 1);
    // Filter out internal bash / system variables
    if (!key.startsWith('_') && !FILTERED_VARS.has(key)) {
      envVars.set(key, val);
    }
  }

  return { cwd, envVars };
}

/**
 * Split stdout lines into user-visible output and the state block.
 * Returns [userLines, stateLines].
 */
export function splitOutputAtSentinel(
  lines: string[],
): [string[], string[]] {
  // Find the LAST occurrence of the sentinel (in case user output also contains it)
  let sentinelPos = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() === SHELL_STATE_SENTINEL) {
      sentinelPos = i;
      break;
    }
  }

  if (sentinelPos === -1) {
    return [lines, []];
  }

  return [lines.slice(0, sentinelPos), lines.slice(sentinelPos + 1)];
}
