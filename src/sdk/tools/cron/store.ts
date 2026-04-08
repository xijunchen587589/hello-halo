/**
 * @module tools/cron/store
 * CronStore — In-memory store for cron tasks with optional disk persistence.
 * @license MIT
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** 7 days in ms — tasks older than this are purged on load. */
const MAX_TASK_AGE_MS = 7 * 24 * 3600 * 1000;

/** A scheduled cron task. */
export interface CronTask {
  id: string;
  cron: string;
  prompt: string;
  recurring: boolean;
  durable: boolean;
  createdAt: number;
}

/**
 * In-memory store for cron tasks.
 * Durable tasks are persisted to `~/.claude/scheduled_tasks.json`.
 */
class CronStore {
  private tasks = new Map<string, CronTask>();
  private loaded = false;

  /** Ensure tasks have been loaded from disk (once per process). */
  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    const path = this.diskPath();
    if (!path) return;

    try {
      const data = await readFile(path, 'utf-8');
      const tasks: CronTask[] = JSON.parse(data);
      const now = Date.now();
      for (const task of tasks) {
        // Drop tasks older than MAX_TASK_AGE_MS
        if (now - task.createdAt > MAX_TASK_AGE_MS) continue;
        this.tasks.set(task.id, task);
      }
    } catch {
      // File doesn't exist yet or is invalid — that's fine
    }
  }

  set(id: string, task: CronTask): void {
    this.tasks.set(id, task);
  }

  get(id: string): CronTask | undefined {
    return this.tasks.get(id);
  }

  remove(id: string): CronTask | undefined {
    const task = this.tasks.get(id);
    if (task) this.tasks.delete(id);
    return task;
  }

  getAll(): CronTask[] {
    return Array.from(this.tasks.values());
  }

  size(): number {
    return this.tasks.size;
  }

  /** Get the disk path for persisted tasks. */
  private diskPath(): string | null {
    try {
      return join(homedir(), '.claude', 'scheduled_tasks.json');
    } catch {
      return null;
    }
  }

  /** Get durable tasks for persistence. */
  getDurableTasks(): CronTask[] {
    return this.getAll().filter((t) => t.durable);
  }
}

/** Global cron store singleton. */
export const cronStore = new CronStore();

/** Persist all durable tasks to disk. */
export async function persistTasksToDisk(): Promise<void> {
  const durable = cronStore.getDurableTasks();
  const json = JSON.stringify(durable, null, 2);

  try {
    const dir = join(homedir(), '.claude');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'scheduled_tasks.json'), json, 'utf-8');
  } catch {
    // Non-fatal: disk persistence is best-effort
  }
}

// ---------------------------------------------------------------------------
// Cron expression utilities
// ---------------------------------------------------------------------------

/** Validate that a 5-field cron expression is syntactically correct. */
export function validateCron(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  // Ranges: M(0-59), H(0-23), DoM(1-31), Mon(1-12), DoW(0-7)
  const ranges: [number, number][] = [
    [0, 59], [0, 23], [1, 31], [1, 12], [0, 7],
  ];

  for (let i = 0; i < 5; i++) {
    const field = fields[i];
    if (field === '*') continue;

    // Handle */N (step)
    if (field.startsWith('*/')) {
      const step = parseInt(field.slice(2), 10);
      if (isNaN(step) || step <= 0) return false;
      continue;
    }

    // Handle comma-separated values/ranges
    for (const part of field.split(',')) {
      const dashIdx = part.indexOf('-');
      if (dashIdx !== -1) {
        const lo = parseInt(part.slice(0, dashIdx), 10);
        const hi = parseInt(part.slice(dashIdx + 1), 10);
        if (isNaN(lo) || isNaN(hi)) return false;
        if (lo < ranges[i][0] || hi > ranges[i][1]) return false;
      } else {
        const n = parseInt(part, 10);
        if (isNaN(n)) return false;
        if (n < ranges[i][0] || n > ranges[i][1]) return false;
      }
    }
  }

  return true;
}

/** Convert a cron expression to a human-readable description. */
export function cronToHuman(expr: string): string {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return expr;

  const [minute, hour, dom, month, dow] = fields;

  if (expr.trim() === '* * * * *') return 'every minute';

  if (minute.startsWith('*/')) {
    return `every ${minute.slice(2)} minutes`;
  }

  if (hour === '*' && dom === '*' && month === '*' && dow === '*') {
    return `at minute ${minute} of every hour`;
  }

  if (dom === '*' && month === '*' && dow === '*') {
    return `daily at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
  }

  return `cron(${expr})`;
}

/**
 * Check if a cron expression fires at the given datetime.
 * Used by the scheduler to determine which tasks are due.
 */
export function cronMatches(expr: string, dt: Date): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  const minute = dt.getMinutes();
  const hour = dt.getHours();
  const day = dt.getDate();
  const month = dt.getMonth() + 1; // JS months are 0-based
  const dow = dt.getDay(); // 0=Sunday

  return (
    cronFieldMatches(fields[0], minute) &&
    cronFieldMatches(fields[1], hour) &&
    cronFieldMatches(fields[2], day) &&
    cronFieldMatches(fields[3], month) &&
    cronFieldMatches(fields[4], dow)
  );
}

function cronFieldMatches(field: string, value: number): boolean {
  if (field === '*') return true;

  // */N step
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10);
    return step > 0 && value % step === 0;
  }

  // Comma-separated list
  for (const part of field.split(',')) {
    if (cronRangeMatches(part, value)) return true;
  }

  return false;
}

function cronRangeMatches(part: string, value: number): boolean {
  const dashIdx = part.indexOf('-');
  if (dashIdx !== -1) {
    const lo = parseInt(part.slice(0, dashIdx), 10);
    const hi = parseInt(part.slice(dashIdx + 1), 10);
    return value >= lo && value <= hi;
  }
  const n = parseInt(part, 10);
  // 7 = Sunday alias
  return n === value || (n === 7 && value === 0);
}
