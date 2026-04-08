/**
 * @module tools/worktree/state
 * Session-level worktree state. Only one active worktree per session.
 * @license MIT
 */

/** Information about an active worktree session. */
export interface WorktreeSessionInfo {
  originalCwd: string;
  worktreePath: string;
  branch: string;
  originalHead: string | null;
}

/**
 * Manages the current worktree session.
 * Only one worktree session can be active at a time.
 */
class WorktreeSessionManager {
  private current: WorktreeSessionInfo | null = null;

  get(): WorktreeSessionInfo | null {
    return this.current;
  }

  set(info: WorktreeSessionInfo): void {
    this.current = info;
  }

  clear(): void {
    this.current = null;
  }
}

/** Global worktree session singleton. */
export const worktreeSession = new WorktreeSessionManager();
