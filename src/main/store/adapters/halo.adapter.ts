/**
 * Halo Adapter
 *
 * Implements the original Halo registry protocol:
 *   GET {url}/index.json  → RegistryIndex (already in canonical format)
 *   GET {url}/{path}/spec.yaml → AppSpec YAML
 *
 * This is the default adapter used when sourceType is absent or 'halo'.
 */

import { proxyFetch } from '../../services/proxy-fetch'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { AppSpecSchema } from '../../apps/spec/schema'
import type { AppSpec, SkillSpec } from '../../apps/spec/schema'
import type { RegistrySource, RegistryIndex, RegistryEntry } from '../../../shared/store/store-types'
import type { RegistryAdapter } from './types'

const FETCH_TIMEOUT_MS = 300_000 // 5 min — large indexes (e.g. claude-skills ~21 MB) need headroom

// ── Validation schemas (same as registry.service.ts) ──────────────────────

const APP_TYPE_VALUES = ['automation', 'skill', 'mcp', 'extension'] as const

/**
 * Slug format accepts either:
 *   - Flat:   ^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$           e.g. "xhs-search"
 *   - Scoped: ^[a-z0-9-]+\/[a-z0-9-]+$                    e.g. "openkursar/xhs-search"
 *
 * The scoped form is used for community-authored skills.
 */
const SLUG_FLAT_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const SLUG_SCOPED_RE = /^[a-z0-9-]+\/[a-z0-9-]+$/

const RegistryEntrySchema = z.object({
  slug: z.string().refine(
    (value) => SLUG_FLAT_RE.test(value) || SLUG_SCOPED_RE.test(value),
    { message: 'slug must be either a flat id (e.g. "xhs-search") or scoped "<author>/<id>"' }
  ),
  name: z.string().trim().min(1),
  version: z.string().trim().min(1),
  author: z.string().trim().min(1),
  description: z.string().trim().min(1),
  type: z.enum(APP_TYPE_VALUES),
  // DHP v2 only defines the "bundle" packaging today. Accept missing for
  // backward-compat with registries that haven't shipped the format field
  // yet; reject any other literal so unknown packaging slips don't sneak in.
  format: z.literal('bundle').optional().default('bundle'),
  path: z.string().trim().min(1),
  download_url: z.string().url().optional(),
  size_bytes: z.number().int().nonnegative().optional(),
  checksum: z.string().trim().min(1).optional(),
  category: z.string().trim().default('other'),
  tags: z.array(z.string()).default([]),
  icon: z.string().optional(),
  locale: z.string().optional(),
  min_app_version: z.string().optional(),
  requires_mcps: z.array(z.string()).optional(),
  requires_skills: z.array(z.string()).optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  i18n: z.record(z.string(), z.object({
    name: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).optional(),
  })).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
})

const RegistryIndexSchema = z.object({
  version: z.number(),
  generated_at: z.string(),
  source: z.string(),
  apps: z.array(RegistryEntrySchema),
})

// ── Adapter ────────────────────────────────────────────────────────────────

export class HaloAdapter implements RegistryAdapter {
  readonly strategy = 'mirror' as const

  async fetchIndex(source: RegistrySource): Promise<RegistryIndex> {
    const baseUrl = source.url.replace(/\/+$/, '')
    const t0 = performance.now()

    // Prefer the split layout (digital-humans.json + skills.json + mcps.json);
    // fall back to the legacy single `index.json` if any split file is missing.
    const splitFiles = ['digital-humans.json', 'skills.json', 'mcps.json'] as const

    const splitResults = await Promise.allSettled(
      splitFiles.map(async (file) => {
        const url = `${baseUrl}/${file}`
        const res = await fetchWithTimeout(url, {
          headers: { 'Accept': 'application/json', 'User-Agent': 'Halo-Store/1.0' },
        })
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} for ${file}`)
        }
        return await res.json() as unknown
      })
    )

    const allSplitOk = splitResults.every(r => r.status === 'fulfilled')
    if (allSplitOk) {
      const parts: RegistryIndex[] = []
      for (let i = 0; i < splitResults.length; i++) {
        const result = splitResults[i]
        if (result.status !== 'fulfilled') continue
        const parsed = RegistryIndexSchema.safeParse(result.value)
        if (!parsed.success) {
          // If any split file has invalid schema, fall back to legacy below
          console.warn(
            `[HaloAdapter] Split index "${splitFiles[i]}" failed validation, falling back to index.json: ` +
              parsed.error.issues.map(issue => issue.path.join('.')).join(', ')
          )
          return this.fetchLegacyIndex(baseUrl, t0)
        }
        parts.push(parsed.data as RegistryIndex)
      }

      // Merge: take version/source from the first part, latest generated_at, concat apps
      const merged: RegistryIndex = {
        version: parts[0]?.version ?? 1,
        source: parts[0]?.source ?? baseUrl,
        generated_at: parts
          .map(p => p.generated_at)
          .filter((s): s is string => typeof s === 'string')
          .sort()
          .pop() ?? new Date().toISOString(),
        apps: parts.flatMap(p => p.apps),
      }

      const dt = performance.now() - t0
      console.log(
        `[HaloAdapter] Loaded split index (digital-humans + skills + mcps): ` +
        `${merged.apps.length} apps total (${dt.toFixed(0)}ms)`
      )

      const duplicates = findDuplicateSlugs(merged.apps)
      if (duplicates.length > 0) {
        throw new Error(`Invalid index: duplicate slug(s): ${duplicates.join(', ')}`)
      }
      return merged
    }

    // Fallback: any split file missing → use legacy index.json
    console.log(
      `[HaloAdapter] Split index unavailable (` +
      splitResults
        .map((r, i) => r.status === 'rejected' ? `${splitFiles[i]}=miss` : `${splitFiles[i]}=ok`)
        .join(', ') +
      `), falling back to index.json`
    )
    return this.fetchLegacyIndex(baseUrl, t0)
  }

  /** Legacy single-file `index.json` loader, retained for unmigrated registries. */
  private async fetchLegacyIndex(baseUrl: string, t0: number): Promise<RegistryIndex> {
    const url = `${baseUrl}/index.json`
    const response = await fetchWithTimeout(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Halo-Store/1.0' },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const data = await response.json() as unknown
    const parsed = RegistryIndexSchema.safeParse(data)
    if (!parsed.success) {
      throw new Error(
        `Invalid index format: ${parsed.error.issues.map(i => i.path.join('.')).join(', ') || 'schema mismatch'}`
      )
    }

    const index = parsed.data as RegistryIndex

    const dt = performance.now() - t0
    console.log(`[HaloAdapter] Loaded legacy index.json: ${index.apps.length} apps (${dt.toFixed(0)}ms)`)

    const duplicates = findDuplicateSlugs(index.apps)
    if (duplicates.length > 0) {
      throw new Error(`Invalid index: duplicate slug(s): ${duplicates.join(', ')}`)
    }

    return index
  }

  async fetchSpec(source: RegistrySource, entry: RegistryEntry): Promise<AppSpec> {
    const baseUrl = source.url.replace(/\/+$/, '')
    const specPath = `${entry.path}/spec.yaml`
    const specUrl = entry.download_url || `${baseUrl}/${specPath}`

    const response = await fetchWithTimeout(specUrl, {
      headers: { 'User-Agent': 'Halo-Store/1.0' },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const text = await response.text()
    const raw = parseYaml(text) as Record<string, unknown> | null
    if (!raw || typeof raw !== 'object') {
      throw new Error(`spec.yaml for "${entry.slug}" did not parse to an object`)
    }

    // Wire-format projection: when the registry stores a skill spec it lists
    // `skill_files` as a string[] of file NAMES (the actual contents travel as
    // separate multipart uploads under <path>/files/<name>). The local
    // SkillSpec uses Record<name, content>. Materialize the contents here so
    // the rest of the install pipeline sees the canonical local shape.
    if (raw.type === 'skill' && Array.isArray(raw.skill_files)) {
      const fileNames = (raw.skill_files as unknown[]).filter(
        (v): v is string => typeof v === 'string' && v.length > 0
      )
      const filesBase = `${baseUrl}/${entry.path}/files`
      const materialized: Record<string, string> = {}
      await Promise.all(fileNames.map(async (name) => {
        const url = `${filesBase}/${name}`
        const fileRes = await fetchWithTimeout(url, {
          headers: { 'User-Agent': 'Halo-Store/1.0' },
        })
        if (!fileRes.ok) {
          throw new Error(`Failed to fetch ${name} for "${entry.slug}": HTTP ${fileRes.status}`)
        }
        materialized[name] = await fileRes.text()
      }))
      raw.skill_files = materialized
    }

    const parsedSpec = AppSpecSchema.parse(raw)

    if (parsedSpec.type !== entry.type) {
      throw new Error(
        `Spec type mismatch for "${entry.slug}": index=${entry.type}, spec=${parsedSpec.type}`
      )
    }
    if (parsedSpec.store?.slug && parsedSpec.store.slug !== entry.slug) {
      throw new Error(
        `Spec slug mismatch for "${entry.slug}": index=${entry.slug}, spec=${parsedSpec.store.slug}`
      )
    }

    return parsedSpec
  }

  /**
   * Fetch bundled skill files for skills declared with `bundled: true`.
   *
   * Each skill's `files` array lists relative paths within `skills/{id}/`.
   * Files are fetched directly via the registry's static URL — zero API calls,
   * same pattern as fetchSpec() fetching spec.yaml.
   *
   * URL pattern: {source.url}/{entry.path}/skills/{skillId}/{filePath}
   */
  async fetchBundledSkills(
    source: RegistrySource,
    entry: RegistryEntry,
    skills: Array<{ id: string; files?: string[] }>,
  ): Promise<Map<string, SkillSpec>> {
    const result = new Map<string, SkillSpec>()
    const baseUrl = source.url.replace(/\/+$/, '')

    for (const skill of skills) {
      if (!skill.files || skill.files.length === 0) {
        console.warn(`[HaloAdapter] Bundled skill "${skill.id}" has no files declared — skipping`)
        continue
      }

      const skillBaseUrl = `${baseUrl}/${entry.path}/skills/${skill.id}`
      const skill_files: Record<string, string> = {}

      try {
        // Download all declared files in parallel — static URLs, no API quota
        await Promise.all(skill.files.map(async (filePath) => {
          const url = `${skillBaseUrl}/${filePath}`
          const res = await fetchWithTimeout(url, {
            headers: { 'User-Agent': 'Halo-Store/1.0' },
          })
          if (!res.ok) {
            console.warn(
              `[HaloAdapter] Failed to fetch "${filePath}" for bundled skill "${skill.id}": HTTP ${res.status}`
            )
            return
          }
          skill_files[filePath] = await res.text()
        }))

        if (Object.keys(skill_files).length === 0) {
          console.warn(`[HaloAdapter] No files downloaded for bundled skill "${skill.id}"`)
          continue
        }

        const spec: SkillSpec = {
          spec_version: '1',
          name: skill.id,
          type: 'skill',
          version: '1.0',
          description: `Bundled skill from ${entry.name}`,
          skill_files,
        }
        result.set(skill.id, spec)
        console.log(
          `[HaloAdapter] Fetched bundled skill "${skill.id}" ` +
          `(${Object.keys(skill_files).length} files: ${Object.keys(skill_files).join(', ')})`
        )
      } catch (err) {
        console.warn(
          `[HaloAdapter] Failed to fetch bundled skill "${skill.id}": ${(err as Error).message}`
        )
      }
    }

    return result
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Fetch with a timeout that covers the entire request lifecycle
 * (connection + headers + body reading). The AbortController signal
 * is passed to fetch() so the abort propagates to body consumption too.
 */
export async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const existingSignal = init?.signal

  // If caller already provided a signal, chain abort
  if (existingSignal) {
    if (existingSignal.aborted) {
      controller.abort(existingSignal.reason)
    } else {
      existingSignal.addEventListener('abort', () => controller.abort(existingSignal.reason), { once: true })
    }
  }

  const timeout = setTimeout(() => controller.abort(new Error(`Fetch timeout after ${FETCH_TIMEOUT_MS}ms: ${url}`)), FETCH_TIMEOUT_MS)
  try {
    const response = await proxyFetch(url, { ...init, signal: controller.signal })
    // Return a wrapper that keeps the abort controller alive during body consumption
    return new Proxy(response, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver)
        if (typeof value === 'function' && (prop === 'json' || prop === 'text' || prop === 'arrayBuffer' || prop === 'blob')) {
          return async (...args: unknown[]) => {
            try {
              return await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args)
            } finally {
              clearTimeout(timeout)
            }
          }
        }
        return value
      },
    })
  } catch (err) {
    clearTimeout(timeout)
    throw err
  }
}

function findDuplicateSlugs(entries: RegistryEntry[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const e of entries) {
    if (seen.has(e.slug)) duplicates.add(e.slug)
    else seen.add(e.slug)
  }
  return [...duplicates]
}
