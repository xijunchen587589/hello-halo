/**
 * WeCom Bot IPC Handlers (DEPRECATED)
 *
 * Replaced by im-channels.ts for multi-instance IM channel management.
 * This file is kept for backward compatibility — it delegates to the
 * ImChannelManager under the hood.
 *
 * New clients should use 'im-channels:*' IPC channels instead.
 */

import { ipcMain } from 'electron'
import { getImChannelManager } from '../apps/runtime'

export function registerWecomBotHandlers(): void {
  // GET status — returns aggregate status of all wecom-bot instances
  ipcMain.handle('wecom-bot:status', async () => {
    try {
      const manager = getImChannelManager()
      if (!manager) {
        return { success: true, data: { configured: false, enabled: false, connected: false } }
      }
      const statuses = manager.getAllStatuses().filter(s => s.type === 'wecom-bot')
      const anyConnected = statuses.some(s => s.connected)
      const anyEnabled = statuses.some(s => s.enabled)
      const anyConfigured = statuses.length > 0
      return {
        success: true,
        data: { configured: anyConfigured, enabled: anyEnabled, connected: anyConnected },
      }
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message }
    }
  })

  // Reconnect — reconnects all wecom-bot instances
  ipcMain.handle('wecom-bot:reconnect', async () => {
    try {
      const manager = getImChannelManager()
      if (!manager) {
        return { success: false, error: 'ImChannelManager not initialized' }
      }
      const statuses = manager.getAllStatuses().filter(s => s.type === 'wecom-bot')
      for (const s of statuses) {
        manager.reconnectInstance(s.id)
      }
      return { success: true }
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message }
    }
  })

  console.log('[WecomBot] IPC handlers registered (legacy compat)')
}
