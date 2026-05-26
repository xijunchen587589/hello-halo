/**
 * Failure-based rate limiting and lockout for remote-access login.
 *
 * Two independent counters operate in parallel:
 *   - per-IP   : guards against a single attacker hammering the endpoint
 *   - per-target: catches horizontal attempts that rotate IPs against
 *                 the same credential
 *
 * Counters use a sliding window: any failure older than the window is
 * forgotten. Lockouts are explicit time stamps; they take precedence
 * over the counter and short-circuit the validate path.
 *
 * State is process-local. A restart resets all counters — acceptable
 * for a desktop app, and avoids dragging in persistence concerns.
 */

const IP_WINDOW_MS = 5 * 60 * 1000
const IP_THRESHOLD = 5
const IP_LOCKOUT_MS = 15 * 60 * 1000

const TARGET_WINDOW_MS = 60 * 60 * 1000
const TARGET_THRESHOLD = 10
const TARGET_LOCKOUT_MS = 30 * 60 * 1000

// Single sentinel target — there is exactly one credential per server.
const TARGET_KEY = 'remote-access-token'

interface Counter {
  failures: number[]
  lockedUntil: number
}

const ipState = new Map<string, Counter>()
const targetState = new Map<string, Counter>()

function prune(counter: Counter, now: number, windowMs: number): void {
  while (counter.failures.length > 0 && now - counter.failures[0] > windowMs) {
    counter.failures.shift()
  }
}

function getOrCreate(map: Map<string, Counter>, key: string): Counter {
  let c = map.get(key)
  if (!c) {
    c = { failures: [], lockedUntil: 0 }
    map.set(key, c)
  }
  return c
}

export interface LockState {
  locked: boolean
  retryAfterMs: number
  reason?: 'ip' | 'target'
}

export function checkLock(ip: string): LockState {
  const now = Date.now()
  const ipC = ipState.get(ip)
  if (ipC && ipC.lockedUntil > now) {
    return { locked: true, retryAfterMs: ipC.lockedUntil - now, reason: 'ip' }
  }
  const tgtC = targetState.get(TARGET_KEY)
  if (tgtC && tgtC.lockedUntil > now) {
    return { locked: true, retryAfterMs: tgtC.lockedUntil - now, reason: 'target' }
  }
  return { locked: false, retryAfterMs: 0 }
}

export interface FailureOutcome {
  newlyLocked: boolean
  reason?: 'ip' | 'target'
  retryAfterMs: number
}

/**
 * Record one failed login attempt. Returns whether this attempt pushed
 * one of the counters over a lockout threshold so the caller can fire
 * an alert exactly once per lockout event.
 */
export function recordFailure(ip: string): FailureOutcome {
  const now = Date.now()

  const ipC = getOrCreate(ipState, ip)
  prune(ipC, now, IP_WINDOW_MS)
  ipC.failures.push(now)

  const tgtC = getOrCreate(targetState, TARGET_KEY)
  prune(tgtC, now, TARGET_WINDOW_MS)
  tgtC.failures.push(now)

  // Target lockout takes precedence because it implies a broader campaign.
  if (tgtC.failures.length >= TARGET_THRESHOLD && tgtC.lockedUntil <= now) {
    tgtC.lockedUntil = now + TARGET_LOCKOUT_MS
    tgtC.failures = []
    return { newlyLocked: true, reason: 'target', retryAfterMs: TARGET_LOCKOUT_MS }
  }

  if (ipC.failures.length >= IP_THRESHOLD && ipC.lockedUntil <= now) {
    ipC.lockedUntil = now + IP_LOCKOUT_MS
    ipC.failures = []
    return { newlyLocked: true, reason: 'ip', retryAfterMs: IP_LOCKOUT_MS }
  }

  return { newlyLocked: false, retryAfterMs: 0 }
}

/**
 * Reset counters for a given IP after a successful login. Target
 * counters are NOT cleared automatically — a horizontal attacker may
 * still be probing other IPs against the same target.
 */
export function recordSuccess(ip: string): void {
  ipState.delete(ip)
}

/**
 * Test-only: wipe all counters. Production code never calls this.
 */
export function _resetAll(): void {
  ipState.clear()
  targetState.clear()
}
