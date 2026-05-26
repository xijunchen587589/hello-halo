/**
 * Store IPC Handlers
 *
 * Exposes the Store (App Registry) operations to the renderer process.
 *
 * Channels:
 *   store:query                          Paginated query (new primary entry point)
 *   store:list-apps                      List apps from the store with optional filtering
 *   store:get-app-detail                 Get detailed info about a store app by slug
 *   store:install                        Install an app from the store into a space
 *   store:refresh                        Refresh the registry index from remote sources
 *   store:check-updates                  Check for available updates for installed apps
 *   store:get-registries                 Get the list of configured registry sources
 *   store:add-registry                   Add a new registry source
 *   store:remove-registry                Remove a registry source
 *   store:toggle-registry                Enable or disable a registry source
 *   store:update-registry-adapter-config Update adapter config (e.g. API keys) for a registry
 */

import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import * as storeController from '../controllers/store.controller'
import {
  onSyncStatusChanged,
  onUpgradeAvailable,
  applyUpgrade,
  checkUpgradesNow,
  publish,
  packDhpkg,
  unpackDhpkg,
} from '../store'
import { getAppManager } from '../apps/manager'
import { getAppRuntime } from '../apps/runtime'
import { sendToRenderer } from '../services/window.service'
import type { StoreInstallProgress } from '../../shared/store/store-types'
import type { SkillSpec } from '../apps/spec'

export function registerStoreHandlers(): void {
  // ── store:query (new primary entry point) ─────────────────────────────
  ipcMain.handle(
    'store:query',
    async (_event, params: { search?: string; type?: string; category?: string; page?: number; pageSize?: number; locale?: string }) => {
      return storeController.queryStoreApps(params)
    }
  )

  // ── store:list-apps (legacy compat) ─────────────────────────────────
  ipcMain.handle(
    'store:list-apps',
    async (_event, query?: { search?: string; category?: string; type?: string; tags?: string[] }) => {
      return storeController.listStoreApps(query)
    }
  )

  // ── store:get-app-detail ───────────────────────────────────────────────
  ipcMain.handle(
    'store:get-app-detail',
    async (_event, slug: string) => {
      return storeController.getStoreAppDetail(slug)
    }
  )

  // ── store:install ──────────────────────────────────────────────────────
  ipcMain.handle(
    'store:install',
    async (event, input: { slug: string; spaceId: string | null; userConfig?: Record<string, unknown>; progressChannel?: string }) => {
      const { slug, spaceId, userConfig, progressChannel } = input

      // Build progress emitter if the renderer provided a channel name
      const onProgress = progressChannel
        ? (filesComplete: number, filesTotal: number, currentFile: string) => {
            const isAllDownloaded = filesTotal > 0 && filesComplete >= filesTotal
            const progress: StoreInstallProgress = {
              installId: progressChannel,
              phase: filesComplete === 0 && filesTotal === 0
                ? 'fetching-tree'
                : isAllDownloaded ? 'installing' : 'downloading',
              filesComplete,
              filesTotal,
              currentFile,
              // Reserve last 10% for the install step; downloading spans 0–90%
              percent: filesTotal === 0
                ? 5
                : isAllDownloaded
                  ? 90
                  : Math.round(10 + (filesComplete / filesTotal) * 80),
              message: filesComplete === 0 && filesTotal === 0
                ? 'Fetching file list...'
                : isAllDownloaded
                  ? 'Installing...'
                  : `Downloading files (${filesComplete}/${filesTotal})`,
            }
            // Guard against destroyed renderer (e.g. window closed mid-install)
            if (!event.sender.isDestroyed()) {
              event.sender.send(progressChannel, progress)
            }
          }
        : undefined

      return storeController.installStoreApp(slug, spaceId, userConfig, onProgress)
    }
  )

  // ── store:refresh ──────────────────────────────────────────────────────
  ipcMain.handle(
    'store:refresh',
    async () => {
      return storeController.refreshStoreIndex()
    }
  )

  // ── store:check-updates ────────────────────────────────────────────────
  ipcMain.handle(
    'store:check-updates',
    async () => {
      return storeController.checkStoreUpdates()
    }
  )

  // ── store:get-registries ───────────────────────────────────────────────
  ipcMain.handle(
    'store:get-registries',
    async () => {
      return storeController.getStoreRegistries()
    }
  )

  // ── store:add-registry ─────────────────────────────────────────────────
  ipcMain.handle(
    'store:add-registry',
    async (_event, input: { name: string; url: string; sourceType?: string; adapterConfig?: Record<string, unknown> }) => {
      return storeController.addStoreRegistry(input)
    }
  )

  // ── store:remove-registry ──────────────────────────────────────────────
  ipcMain.handle(
    'store:remove-registry',
    async (_event, registryId: string) => {
      return storeController.removeStoreRegistry(registryId)
    }
  )

  // ── store:toggle-registry ──────────────────────────────────────────────
  ipcMain.handle(
    'store:toggle-registry',
    async (_event, input: { registryId: string; enabled: boolean }) => {
      return storeController.toggleStoreRegistry(input.registryId, input.enabled)
    }
  )

  // ── store:update-registry-adapter-config ───────────────────────────────
  ipcMain.handle(
    'store:update-registry-adapter-config',
    async (_event, input: { registryId: string; adapterConfig: Record<string, unknown> }) => {
      return storeController.updateStoreRegistryAdapterConfig(input.registryId, input.adapterConfig)
    }
  )

  // ── store:check-updates-now (manual trigger for the periodic upgrade loop) ─
  ipcMain.handle('store:check-updates-now', async () => {
    try {
      const result = await checkUpgradesNow()
      return { success: true, data: result }
    } catch (error: unknown) {
      const err = error as Error
      console.error('[StoreIPC] store:check-updates-now error:', err.message)
      return { success: false, error: err.message }
    }
  })

  // ── store:apply-upgrade ────────────────────────────────────────────────
  ipcMain.handle(
    'store:apply-upgrade',
    async (_event, input: { appId: string; mode?: 'patch_minor' | 'major' | 'force' }) => {
      try {
        const result = await applyUpgrade(input.appId, input.mode ?? 'force')
        console.log(`[StoreIPC] store:apply-upgrade: ${result.appId} ${result.from} -> ${result.to}`)
        return { success: true, data: result }
      } catch (error: unknown) {
        const err = error as Error
        console.error('[StoreIPC] store:apply-upgrade error:', err.message)
        return { success: false, error: err.message }
      }
    }
  )

  // ── store:publish ──────────────────────────────────────────────────────
  ipcMain.handle('store:publish', async (_event, input: { appId: string; author?: string }) => {
    try {
      const result = await publish(input.appId, input.author)
      // Always include details so production logs let us trace failures end-to-end.
      console.log(
        `[StoreIPC] store:publish: appId=${input.appId} status=${result.status} target=${result.target}` +
        (result.details ? ` details=${JSON.stringify(result.details)}` : '')
      )
      return {
        success: result.status !== 'error',
        data: result,
        // Surface details as `error` too so renderer-side `res.error` shows it
        // without callers having to inspect `res.data.details`.
        error: result.status === 'error' ? result.details : undefined,
      }
    } catch (error: unknown) {
      const err = error as Error
      console.error('[StoreIPC] store:publish error:', err.message)
      return { success: false, error: err.message }
    }
  })

  // ── store:export-dhpkg ─────────────────────────────────────────────────
  ipcMain.handle('store:export-dhpkg', async (event, input: { appId: string }) => {
    try {
      const manager = getAppManager()
      if (!manager) return { success: false, error: 'App Manager not ready' }
      const app = manager.getApp(input.appId)
      if (!app) return { success: false, error: `App not found: ${input.appId}` }

      const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
      const safeName = (app.spec.store?.slug ?? app.spec.name).replace(/[^a-z0-9-]/gi, '-').toLowerCase()
      const dialogResult = await dialog.showSaveDialog(win!, {
        title: 'Export as .dhpkg',
        defaultPath: `${safeName}-${app.spec.version ?? '0.0.0'}.dhpkg`,
        filters: [{ name: 'DHP Package', extensions: ['dhpkg'] }],
      })

      if (dialogResult.canceled || !dialogResult.filePath) {
        return { success: false, error: 'User cancelled' }
      }

      const files: Record<string, string> = app.spec.type === 'skill'
        ? ((app.spec as SkillSpec).skill_files ?? {})
        : {}

      const buf = await packDhpkg(app.spec, files)
      await writeFile(dialogResult.filePath, buf)

      console.log(`[StoreIPC] store:export-dhpkg: appId=${input.appId} -> ${dialogResult.filePath}`)
      return { success: true, data: { path: dialogResult.filePath } }
    } catch (error: unknown) {
      const err = error as Error
      console.error('[StoreIPC] store:export-dhpkg error:', err.message)
      return { success: false, error: err.message }
    }
  })

  // ── store:import-dhpkg ─────────────────────────────────────────────────
  ipcMain.handle(
    'store:import-dhpkg',
    async (event, input: { filePath?: string; spaceId?: string | null }) => {
      try {
        let filePath = input?.filePath
        if (!filePath) {
          const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
          const dialogResult = await dialog.showOpenDialog(win!, {
            title: 'Import .dhpkg',
            filters: [{ name: 'DHP Package', extensions: ['dhpkg', 'zip'] }],
            properties: ['openFile'],
          })
          if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
            return { success: false, error: 'User cancelled' }
          }
          filePath = dialogResult.filePaths[0]
        }

        const buf = await readFile(filePath)
        const { spec } = await unpackDhpkg(buf)

        const manager = getAppManager()
        if (!manager) return { success: false, error: 'App Manager not ready' }

        const spaceId = input?.spaceId ?? null
        const appId = await manager.install(spaceId, spec, {})

        // Best-effort activation — same pattern as installFromStore
        const runtime = getAppRuntime()
        if (runtime) {
          try {
            await runtime.activate(appId)
          } catch (err) {
            console.warn(
              `[StoreIPC] store:import-dhpkg: runtime activate failed (non-fatal): ${(err as Error).message}`
            )
          }
        }

        console.log(`[StoreIPC] store:import-dhpkg: ${filePath} -> appId=${appId}`)
        return { success: true, data: { appId } }
      } catch (error: unknown) {
        const err = error as Error
        console.error('[StoreIPC] store:import-dhpkg error:', err.message)
        return { success: false, error: err.message }
      }
    }
  )

  // ── Sync status push (main → renderer) ──────────────────────────────
  onSyncStatusChanged((event) => {
    sendToRenderer('store:sync-status-changed', event)
  })

  // ── Upgrade-available push (main → renderer) ────────────────────────
  onUpgradeAvailable((event) => {
    sendToRenderer('store:upgrade-available', event)
  })

  console.log('[StoreIPC] Store handlers registered (13 channels + sync push + upgrade push)')
}
