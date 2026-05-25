/**
 * Entry point for publishing an installed App to the configured registry.
 *
 * The dispatcher is selected from `loadProductConfig().registryOverrides`;
 * the renderer never picks a target.
 */

import { loadProductConfig } from '../../services/ai-sources/auth-loader'
import { getAppManager } from '../../apps/manager'
import { getRegistries } from '../registry.service'
import { dispatch as dispatchGithubPr } from './dispatchers/github-pr'
import { dispatch as dispatchHttpRegistry } from './dispatchers/http-registry'
import { dispatch as dispatchLocalDhpkg } from './dispatchers/local-dhpkg'
import { enrichSpecForPublish } from './spec-enrich'
import type { PublishResult, PublishContext } from './types'
import type { AppSpec, SkillSpec } from '../../apps/spec'

/**
 * Resolve the publish target for the official registry from product config.
 * Returns `null` when none is configured — UI should hide the Publish button.
 * Only the `official` override is consulted; other registries are read-only mirrors.
 */
export function resolvePublishTarget(): { registryId: string; config: NonNullable<NonNullable<ReturnType<typeof loadProductConfig>['registryOverrides']>[string]['publish']> } | null {
  const overrides = loadProductConfig().registryOverrides ?? {}
  const officialPublish = overrides['official']?.publish
  if (!officialPublish) return null
  return { registryId: 'official', config: officialPublish }
}

/** Publish an installed App through the configured dispatcher. */
export async function publish(appId: string): Promise<PublishResult> {
  const manager = getAppManager()
  if (!manager) {
    return { status: 'error', target: 'local-dhpkg', details: 'App Manager is not yet initialized' }
  }

  const app = manager.getApp(appId)
  if (!app) {
    return { status: 'error', target: 'local-dhpkg', details: `App not found: ${appId}` }
  }

  const target = resolvePublishTarget()
  if (!target) {
    return {
      status: 'error',
      target: 'local-dhpkg',
      details: 'No publish target configured in product.json (registryOverrides.official.publish).',
    }
  }

  // Enrich publish-only metadata (e.g. derive store.slug from name) so any
  // spec the local runtime accepts is also accepted by registries. Kept out
  // of the create-time schema so locally-running apps aren't forced to
  // populate distribution fields they don't use.
  let spec: AppSpec
  try {
    spec = enrichSpecForPublish(app.spec)
  } catch (e) {
    return {
      status: 'error',
      target: 'local-dhpkg',
      details: (e as Error).message,
    }
  }
  const files = collectFiles(spec)

  const registries = getRegistries()
  const registry = registries.find(r => r.id === target.registryId)
  const ctx: PublishContext = {
    registryId: target.registryId,
    registryUrl: registry?.url ?? null,
  }

  console.log(
    `[publish] Dispatching app ${appId} ("${spec.name}") via target=${target.config.target}`
  )

  switch (target.config.target) {
    case 'github-pr':
      return dispatchGithubPr(spec, files, ctx, { github: target.config.github })
    case 'http-registry':
      return dispatchHttpRegistry(spec, files, ctx, {
        url: registry?.url,
        token: target.config.token,
      })
    case 'local-dhpkg':
      return dispatchLocalDhpkg(spec, files, ctx, {})
    default: {
      const _exhaustive: never = target.config.target
      return {
        status: 'error',
        target: 'local-dhpkg',
        details: `Unknown publish target: ${_exhaustive as string}`,
      }
    }
  }
}

/** Extract inline files (currently only `skill_files`) for the dispatcher. */
function collectFiles(spec: AppSpec): Record<string, string> {
  if (spec.type === 'skill') {
    const skillFiles = (spec as SkillSpec).skill_files ?? {}
    return { ...skillFiles }
  }
  return {}
}
