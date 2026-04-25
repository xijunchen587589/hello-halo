/**
 * Idle Queue — Tier 3 startup tasks
 *
 * Provides a simple queue for non-critical initialization tasks that run
 * after all essential and extended services are ready. Each task runs
 * sequentially with setImmediate yielding between them. Failures are
 * logged as warnings and never interrupt the queue or the process.
 *
 * Usage:
 *   registerIdleTask('my-task', async () => { ... })
 *   startIdleDrain()   // call once after Tier 2 is complete
 */

type IdleTask = { name: string; fn: () => Promise<void> | void }

const queue: IdleTask[] = []
let draining = false
let idle = false  // true when drain loop has exited due to empty queue

/**
 * Register a task to run during the idle phase.
 *
 * Can be called before or after startIdleDrain(). Tasks registered after
 * the queue has been drained are picked up immediately via a re-scheduled
 * drainNext().
 */
export function registerIdleTask(name: string, fn: () => Promise<void> | void): void {
  queue.push({ name, fn })

  // If we already drained and went idle, restart the drain loop
  if (idle) {
    idle = false
    setImmediate(drainNext)
  }
}

/**
 * Begin draining the idle queue. Each task yields to the event loop
 * via setImmediate before the next task runs.
 *
 * Safe to call only once — subsequent calls are no-ops.
 */
export function startIdleDrain(): void {
  if (draining) return
  draining = true
  drainNext()
}

function drainNext(): void {
  const task = queue.shift()
  if (!task) {
    idle = true
    return
  }

  idle = false
  const t0 = performance.now()

  Promise.resolve()
    .then(() => task.fn())
    .then(() => {
      const dt = (performance.now() - t0).toFixed(1)
      console.log(`[Idle] ${task.name} completed (${dt}ms)`)
    })
    .catch((err) => {
      console.warn(`[Idle] ${task.name} failed (non-critical):`, err)
    })
    .finally(() => {
      setImmediate(drainNext)
    })
}
