/**
 * Security Policy IPC
 *
 * Exposes the renderer-safe slice of {@link SecurityPolicy} so the UI can
 * gate features (e.g. hide the Tunnel section when `tunnelSafe` is on).
 *
 * Design notes:
 *   - The renderer never receives the full {@link SecurityPolicy} — only
 *     the closed shape defined by {@link PublicSecurityPolicy}. Adding a
 *     new renderer-visible flag requires touching `getPublicSecurityPolicy()`
 *     in `services/security-policy.ts`, which keeps every exposure
 *     decision in one reviewable place.
 *   - Policy is sourced from `product.json` at startup. The value cannot
 *     change at runtime, so the renderer hook caches the response for the
 *     lifetime of the window (see `hooks/useSecurityPolicy.ts`).
 */

import { ipcMain } from 'electron'
import { getPublicSecurityPolicy } from '../services/security-policy'

export function registerSecurityHandlers(): void {
  ipcMain.handle('security:get-public-policy', async () => {
    try {
      return { success: true, data: getPublicSecurityPolicy() }
    } catch (error: unknown) {
      const err = error as Error
      console.error('[Settings] security:get-public-policy - Failed:', err.message)
      return { success: false, error: err.message }
    }
  })

  console.log('[Settings] Security handlers registered')
}
