/**
 * Unit tests for ShellStateManager and BackgroundTaskRegistry cleanup.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ShellStateManager } from './shell-state.js';
import { BackgroundTaskRegistry } from './background.js';

// ---------------------------------------------------------------------------
// ShellStateManager
// ---------------------------------------------------------------------------

describe('ShellStateManager', () => {
  let mgr: ShellStateManager;

  beforeEach(() => {
    mgr = new ShellStateManager();
  });

  it('creates a fresh state on first access', () => {
    const state = mgr.get('session-1', '/home/user');
    expect(state.cwd).toBe('/home/user');
    expect(state.envVars.size).toBe(0);
  });

  it('returns the same state object on subsequent gets', () => {
    const s1 = mgr.get('session-1', '/home/user');
    s1.cwd = '/tmp';
    const s2 = mgr.get('session-1', '/home/user');
    expect(s2.cwd).toBe('/tmp');
  });

  it('isolates state by sessionId', () => {
    const a = mgr.get('session-a', '/home/a');
    const b = mgr.get('session-b', '/home/b');
    a.cwd = '/home/a/changed';
    expect(b.cwd).toBe('/home/b');
  });

  it('isolates state by agentId within a session', () => {
    const parent = mgr.get('session-1', '/home/user');
    const child = mgr.get('session-1', '/home/user', 'agent-child');
    parent.cwd = '/parent';
    child.cwd = '/child';
    expect(mgr.get('session-1', '/home/user').cwd).toBe('/parent');
    expect(mgr.get('session-1', '/home/user', 'agent-child').cwd).toBe('/child');
  });

  it('removes a specific agent-scoped state', () => {
    mgr.get('session-1', '/home', 'agent-1').cwd = '/a1';
    mgr.get('session-1', '/home', 'agent-2').cwd = '/a2';
    mgr.remove('session-1', 'agent-1');
    // agent-2 survives
    expect(mgr.get('session-1', '/home', 'agent-2').cwd).toBe('/a2');
    // agent-1 resets to default
    expect(mgr.get('session-1', '/fresh', 'agent-1').cwd).toBe('/fresh');
  });

  it('removeAll clears session-level state', () => {
    mgr.get('session-1', '/home').cwd = '/changed';
    mgr.removeAll('session-1');
    // After removeAll, a new get returns the default cwd
    expect(mgr.get('session-1', '/default').cwd).toBe('/default');
  });

  it('removeAll clears all agent-scoped states for the session', () => {
    mgr.get('session-1', '/home').cwd = '/root';
    mgr.get('session-1', '/home', 'agent-a').cwd = '/a';
    mgr.get('session-1', '/home', 'agent-b').cwd = '/b';
    mgr.get('session-2', '/home').cwd = '/session2';

    mgr.removeAll('session-1');

    // session-1 entries are gone
    expect(mgr.get('session-1', '/fresh').cwd).toBe('/fresh');
    expect(mgr.get('session-1', '/fresh', 'agent-a').cwd).toBe('/fresh');

    // session-2 is untouched
    expect(mgr.get('session-2', '/home').cwd).toBe('/session2');
  });

  it('removeAll is idempotent', () => {
    mgr.get('session-x', '/home');
    mgr.removeAll('session-x');
    expect(() => mgr.removeAll('session-x')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// BackgroundTaskRegistry.pruneCompleted
// ---------------------------------------------------------------------------

describe('BackgroundTaskRegistry', () => {
  it('pruneCompleted removes old finished tasks', () => {
    const registry = new BackgroundTaskRegistry();

    const running = registry.register('cmd-running');

    const oldDone = registry.register('cmd-old-done');
    registry.complete(oldDone.id, 0);
    // Backdate completedAt to simulate old task
    const oldDoneTask = registry.get(oldDone.id)!;
    (oldDoneTask as { completedAt: number }).completedAt = Date.now() - 7_200_000; // 2 hours ago

    const recentDone = registry.register('cmd-recent-done');
    registry.complete(recentDone.id, 0);

    // Prune tasks older than 1 hour
    registry.pruneCompleted(3_600_000);

    expect(registry.get(running.id)).toBeDefined();     // still running → kept
    expect(registry.get(recentDone.id)).toBeDefined(); // recent → kept
    expect(registry.get(oldDone.id)).toBeUndefined();  // old → pruned
  });

  it('pruneCompleted does not touch running tasks', () => {
    const registry = new BackgroundTaskRegistry();
    const task = registry.register('long-running');
    // Backdate startedAt as if it were very old
    (task as { startedAt: number }).startedAt = Date.now() - 10_000_000;

    registry.pruneCompleted(0); // prune everything older than 0ms
    expect(registry.get(task.id)).toBeDefined(); // still running → not pruned
  });

  it('getAll reflects pruning', () => {
    const registry = new BackgroundTaskRegistry();
    const t1 = registry.register('a');
    const t2 = registry.register('b');
    registry.complete(t1.id, 0);
    // Make t1 look old
    (registry.get(t1.id)! as { completedAt: number }).completedAt = Date.now() - 7_200_000;

    registry.pruneCompleted(3_600_000);

    const all = registry.getAll();
    expect(all.some(t => t.id === t1.id)).toBe(false);
    expect(all.some(t => t.id === t2.id)).toBe(true);
  });
});
