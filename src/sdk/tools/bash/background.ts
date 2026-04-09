/**
 * @module tools/bash/background
 * Background execution support for the Bash tool.
 * When run_in_background is true, the process is spawned detached
 * and the tool returns immediately with a task ID.
 * @license MIT
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

/** Status of a background task. */
export type BackgroundTaskStatus = 'running' | 'completed' | 'failed';

/** A background task record. */
export interface BackgroundTask {
  id: string;
  command: string;
  status: BackgroundTaskStatus;
  output: string[];
  exitCode: number | null;
  error: string | null;
  pid: number | undefined;
  startedAt: number;
  completedAt: number | null;
}

/** Global registry of background tasks. */
export class BackgroundTaskRegistry {
  private tasks = new Map<string, BackgroundTask>();

  register(command: string): BackgroundTask {
    const id = randomUUID().slice(0, 8);
    const task: BackgroundTask = {
      id,
      command,
      status: 'running',
      output: [],
      exitCode: null,
      error: null,
      pid: undefined,
      startedAt: Date.now(),
      completedAt: null,
    };
    this.tasks.set(id, task);
    return task;
  }

  get(id: string): BackgroundTask | undefined {
    return this.tasks.get(id);
  }

  getAll(): BackgroundTask[] {
    return Array.from(this.tasks.values());
  }

  appendOutput(id: string, line: string): void {
    const task = this.tasks.get(id);
    if (task) task.output.push(line);
  }

  complete(id: string, exitCode: number): void {
    const task = this.tasks.get(id);
    if (task) {
      task.status = exitCode === 0 ? 'completed' : 'failed';
      task.exitCode = exitCode;
      task.completedAt = Date.now();
    }
  }

  fail(id: string, error: string): void {
    const task = this.tasks.get(id);
    if (task) {
      task.status = 'failed';
      task.error = error;
      task.completedAt = Date.now();
    }
  }

  /**
   * Remove completed/failed tasks older than `maxAgeMs` milliseconds.
   * Running tasks are never pruned.
   */
  pruneCompleted(maxAgeMs: number): void {
    const cutoff = Date.now() - maxAgeMs;
    for (const [id, task] of this.tasks) {
      if (task.status !== 'running' && task.completedAt !== null && task.completedAt < cutoff) {
        this.tasks.delete(id);
      }
    }
  }
}

/** Global singleton. */
export const backgroundRegistry = new BackgroundTaskRegistry();

/**
 * Run a command in the background.
 * Spawns the process detached and returns immediately with task info.
 */
export function runInBackground(
  command: string,
  cwd: string,
  timeoutMs: number,
): { taskId: string; message: string } {
  const task = backgroundRegistry.register(command);

  const child = spawn('bash', ['-c', command], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  task.pid = child.pid;

  // Set up timeout
  const timer = setTimeout(() => {
    try {
      if (child.pid) process.kill(-child.pid, 'SIGTERM');
    } catch {
      // Process may have already exited
    }
    setTimeout(() => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        // Process may have already exited
      }
    }, 5000);
    backgroundRegistry.fail(task.id, `Timed out after ${timeoutMs}ms`);
  }, timeoutMs);

  // Collect output
  child.stdout?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      backgroundRegistry.appendOutput(task.id, line);
    }
  });

  child.stderr?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      backgroundRegistry.appendOutput(task.id, `STDERR: ${line}`);
    }
  });

  child.on('close', (code) => {
    clearTimeout(timer);
    backgroundRegistry.complete(task.id, code ?? -1);
  });

  child.on('error', (err) => {
    clearTimeout(timer);
    backgroundRegistry.fail(task.id, err.message);
  });

  // Unref so the parent process can exit independently
  child.unref();

  return {
    taskId: task.id,
    message: `Command started in background.\nTask ID: ${task.id}\nCommand: ${command}`,
  };
}
