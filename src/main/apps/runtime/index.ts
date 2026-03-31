/**
 * apps/runtime -- Public API
 *
 * App execution engine: activate, execute, report, escalate.
 *
 * This is the core glue layer that connects all platform modules
 * (scheduler, memory, background) with the Agent service to provide
 * autonomous App execution capabilities.
 *
 * The event routing layer (source adapters, filter engine, dedup cache)
 * is owned internally by the runtime module. The platform layer provides
 * only generic Emitter<T> for service-to-service communication.
 *
 * Usage in bootstrap/extended.ts:
 *
 *   import { initAppRuntime, shutdownAppRuntime } from '../apps/runtime'
 *
 *   const runtime = await initAppRuntime({
 *     db, appManager, scheduler, memory, background
 *   })
 *
 *   // At shutdown:
 *   await shutdownAppRuntime()
 *
 * Usage in IPC handlers:
 *
 *   import type { AppRuntimeService } from '../apps/runtime'
 *
 *   function handleManualTrigger(runtime: AppRuntimeService, appId: string) {
 *     return runtime.triggerManually(appId)
 *   }
 */

import type { DatabaseManager } from '../../platform/store'
import type { AppManagerService } from '../manager'
import type { SchedulerService } from '../../platform/scheduler'
import type { MemoryService } from '../../platform/memory'
import type { BackgroundService } from '../../platform/background'
import type { ImChannelAdapter } from '../../../shared/types/im-channel'
import { join } from 'path'
import { homedir } from 'os'
import { getSpace } from '../../services/space.service'
import { getExpressApp } from '../../http/server'
import * as watcherHost from '../../services/watcher-host.service'
import { ActivityStore } from './store'
import { createAppRuntimeService } from './service'
import { MIGRATION_NAMESPACE, migrations } from './migrations'
import { createEventRouter, type EventRouter } from './event-router'
import { FileWatcherSource } from './sources/file-watcher.source'
import { WebhookSource, type WebhookSecretResolver } from './sources/webhook.source'
import { WecomBotSource } from './sources/wecom-bot.source'
import { ImSessionRegistry, setImSessionRegistry } from './im-session-registry'
import { getConfig } from '../../services/config.service'
import { getDataFolderName } from '../../services/ai-sources/auth-loader'
import type { AppRuntimeService } from './types'

// Re-export types for consumers
export type {
  AppRuntimeService,
  AppRunResult,
  AutomationAppState,
  AutomationRun,
  ActivityEntry,
  ActivityEntryContent,
  ActivityEntryType,
  ActivityQueryOptions,
  EscalationResponse,
  TriggerContext,
  TriggerType,
  RunStatus,
  ActivationState,
  AppRuntimeDeps,
} from './types'

// Re-export error types
export {
  AppNotRunnableError,
  NoSubscriptionsError,
  ConcurrencyLimitError,
  EscalationNotFoundError,
  RunExecutionError,
} from './errors'

// Re-export concurrency for testing
export { Semaphore } from './concurrency'

// Re-export app chat functions
export {
  sendAppChatMessage,
  stopAppChat,
  isAppChatGenerating,
  loadAppChatMessages,
  loadImChatMessages,
  getAppChatSessionState,
  getAppChatConversationId,
  buildImSessionKey,
  cleanupAppChatBrowserContext,
  clearAppChat,
  clearImSession,
} from './app-chat'
export type { AppChatRequest } from './app-chat'

// Re-export inbound dispatch
export { dispatchInboundMessage } from './dispatch-inbound'

// Re-export IM session registry accessor
export { getImSessionRegistry } from './im-session-registry'
export { ImSessionRegistry } from './im-session-registry'

// ============================================
// Module State
// ============================================

let runtimeService: AppRuntimeService | null = null
let memoryServiceRef: MemoryService | null = null
let activityStoreRef: ActivityStore | null = null
let eventRouterInstance: EventRouter | null = null
let wecomBotSourceInstance: WecomBotSource | null = null
let imSessionRegistryInstance: ImSessionRegistry | null = null

/** Channel adapter registry: channel identifier → adapter instance */
const channelAdapters = new Map<string, ImChannelAdapter>()

// ============================================
// Initialization
// ============================================

/** Dependencies required to initialize the App Runtime */
interface InitAppRuntimeDeps {
  /** DatabaseManager from platform/store */
  db: DatabaseManager
  /** App Manager service */
  appManager: AppManagerService
  /** Scheduler service */
  scheduler: SchedulerService
  /** Memory service */
  memory: MemoryService
  /** Background service */
  background: BackgroundService
}

/**
 * Normalize a webhook path for matching.
 * Strips leading/trailing slashes and lowercases for consistent comparison.
 */
function normalizeWebhookPath(path: string): string {
  return path.replace(/^\/+|\/+$/g, '').toLowerCase()
}

/**
 * Initialize the App Runtime module.
 *
 * 1. Gets the app-level database from DatabaseManager
 * 2. Runs schema migrations (automation_runs + activity_entries)
 * 3. Creates the EventRouter with source adapters
 * 4. Creates the ActivityStore and AppRuntimeService
 * 5. Starts the EventRouter (after all subscriptions are wired)
 * 6. Activates all Apps with status='active'
 * 7. Returns the AppRuntimeService interface
 *
 * Must be called after all Phase 1 + Phase 2 modules are initialized:
 * - platform/store (Phase 0)
 * - apps/spec (Phase 0)
 * - platform/scheduler (Phase 1)
 * - platform/memory (Phase 1)
 * - platform/background (Phase 1)
 * - apps/manager (Phase 2)
 *
 * @param deps - Injected dependencies
 * @returns Initialized AppRuntimeService
 */
export async function initAppRuntime(
  deps: InitAppRuntimeDeps
): Promise<AppRuntimeService> {
  const start = performance.now()
  console.log('[Runtime] Initializing App Runtime...')

  // Get the app-level database
  const appDb = deps.db.getAppDatabase()

  // Run migrations
  deps.db.runMigrations(appDb, MIGRATION_NAMESPACE, migrations)

  // Create the activity store
  const store = new ActivityStore(appDb)

  // ── Create and wire EventRouter ──────────────────────────────────────
  const eventRouter = createEventRouter()
  eventRouterInstance = eventRouter

  // FileWatcherSource: bridges watcher-host fs events into the event router.
  // Uses addFsEventsHandler() (multi-subscriber) so artifact-cache is not displaced.
  const fileWatcherSource = new FileWatcherSource(watcherHost)
  eventRouter.registerSource(fileWatcherSource)

  // WebhookSource: mounts POST /hooks/* on the Express server to receive
  // inbound webhooks from external services (GitHub, Stripe, etc.).
  // The secret resolver looks up HMAC secrets from installed Apps' webhook
  // subscription configs for per-hook signature verification.
  const webhookSecretResolver: WebhookSecretResolver = (hookPath: string) => {
    const apps = deps.appManager.listApps({ status: 'active', type: 'automation' })
    for (const app of apps) {
      if (app.spec.type !== 'automation') continue
      for (const sub of app.spec.subscriptions ?? []) {
        if (sub.source.type !== 'webhook') continue
        const config = sub.source.config
        // Match if the subscription's configured path matches the incoming hook path
        if (config.path && normalizeWebhookPath(config.path) === normalizeWebhookPath(hookPath)) {
          if (config.secret) return config.secret
        }
      }
    }
    return null
  }
  const webhookSource = new WebhookSource(getExpressApp(), webhookSecretResolver)
  eventRouter.registerSource(webhookSource)

  // WecomBotSource: bridges WeCom intelligent bot WebSocket messages into the event router.
  // Config is resolved at runtime (lazy) so the source adapts to settings changes.
  const wecomBotSource = new WecomBotSource(() => getConfig().wecomBot ?? null)
  eventRouter.registerSource(wecomBotSource)
  wecomBotSourceInstance = wecomBotSource

  // ── IM Session Registry + Channel Adapters ─────────────────────────────
  // The registry tracks all known IM sessions across digital humans.
  // Channel adapters provide the pushToChat() capability for proactive messaging.
  const registryPath = join(homedir(), `.${getDataFolderName()}`, 'im-sessions.json')
  const registry = new ImSessionRegistry(registryPath)
  setImSessionRegistry(registry)
  imSessionRegistryInstance = registry

  // Register WecomBotSource as a channel adapter (implements ImChannelAdapter)
  channelAdapters.set(wecomBotSource.channel, wecomBotSource)

  // ── Create the runtime service ─────────────────────────────────────────
  const service = createAppRuntimeService({
    store,
    appManager: deps.appManager,
    scheduler: deps.scheduler,
    eventRouter,
    memory: deps.memory,
    background: deps.background,
    getSpacePath: (spaceId: string): string | null => {
      const space = getSpace(spaceId)
      return space?.path ?? null
    },
    imSessionRegistry: registry,
    getChannelAdapter: (channel: string) => channelAdapters.get(channel) ?? null,
  })

  // Activate all active automation Apps (registers event subscriptions)
  await service.activateAll()

  // Start the event router AFTER all subscriptions are registered
  // to ensure no events are missed.
  eventRouter.start()

  runtimeService = service
  memoryServiceRef = deps.memory
  activityStoreRef = store

  const duration = performance.now() - start
  console.log(`[Runtime] App Runtime initialized in ${duration.toFixed(1)}ms`)

  return service
}

/**
 * Get the current runtime service instance.
 * Returns null if not yet initialized.
 */
export function getAppRuntime(): AppRuntimeService | null {
  return runtimeService
}

/**
 * Get the memory service instance captured during init.
 * Used by app-chat.ts to build app-specific memory tools.
 */
export function getAppMemoryService(): MemoryService | null {
  return memoryServiceRef
}

/**
 * Get the activity store instance captured during init.
 * Used by app-chat.ts to provide report_to_user in chat mode.
 */
export function getActivityStore(): ActivityStore | null {
  return activityStoreRef
}

/**
 * Get the WecomBotSource instance for external use (e.g., reconnect on config change).
 */
export function getWecomBotSource(): WecomBotSource | null {
  return wecomBotSourceInstance
}

/**
 * Shutdown the App Runtime module.
 *
 * 1. Deactivates all Apps (removes scheduler jobs + event subscriptions)
 * 2. Stops the event router and all source adapters
 * 3. Cancels all running executions
 * 4. Clears the module state
 */
export async function shutdownAppRuntime(): Promise<void> {
  console.log('[Runtime] Shutting down App Runtime...')

  if (runtimeService) {
    await runtimeService.deactivateAll()
    runtimeService = null
    memoryServiceRef = null
    activityStoreRef = null
  }

  if (eventRouterInstance) {
    eventRouterInstance.stop()
    eventRouterInstance = null
  }

  wecomBotSourceInstance = null
  imSessionRegistryInstance = null
  channelAdapters.clear()
  setImSessionRegistry(null as any)

  console.log('[Runtime] App Runtime shutdown complete')
}
