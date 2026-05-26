/**
 * User-visible alert for security events the host should know about.
 *
 * Kept dependency-light: a single Electron Notification, no renderer
 * coupling. The renderer can subscribe to the audit log if it wants a
 * richer surface later.
 */

import { Notification } from 'electron'

let lastAlertAt = 0
const ALERT_COOLDOWN_MS = 60 * 1000

/**
 * Surface a desktop notification. Cooldown prevents storm scenarios
 * (e.g. an attacker triggering multiple lockouts in quick succession)
 * from spamming the host.
 */
export function notifyLockout(reason: 'ip' | 'target', ip: string): void {
  const now = Date.now()
  if (now - lastAlertAt < ALERT_COOLDOWN_MS) return
  lastAlertAt = now

  if (!Notification.isSupported()) {
    console.warn('[Auth] Notification not supported on this platform')
    return
  }

  const title =
    reason === 'target'
      ? 'Remote access locked'
      : 'Remote access: suspicious activity'
  const body =
    reason === 'target'
      ? `Too many failed login attempts. Remote access is temporarily locked. Last source: ${ip}`
      : `Login attempts from ${ip} have been blocked after repeated failures.`

  try {
    new Notification({ title, body, urgency: 'critical' }).show()
  } catch (err) {
    console.warn('[Auth] Failed to show lockout notification:', (err as Error).message)
  }
}
