/**
 * Pre-dispatch spec enrichment for publish flows.
 *
 * Why this exists: locally-runnable specs may omit publish-only metadata
 * (notably `store.slug`) because the runtime identifies apps by internal
 * UUID. Registries need a URL-safe public identifier and reject specs
 * without one. Rather than push that requirement back into the create flow
 * and Zod schema, we derive a sensible default at publish time so any spec
 * the local runtime accepts is also publishable.
 *
 * The derivation MUST stay in sync with the server-side fallback in
 * digital-human-protocol/server/internal/spec/spec.go (`DeriveSlug`).
 */

import type { AppSpec } from '../../apps/spec'

/**
 * Convert an arbitrary display name into a registry-safe slug:
 *   lowercase → runs of non-[a-z0-9] collapsed to a single hyphen → edge
 *   hyphens trimmed.
 *
 * Returns "" when the input has no usable ASCII alphanumerics (e.g. a
 * pure-CJK name); callers must surface a clear error in that case.
 */
export function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Return a shallow copy of `spec` with publish-only metadata filled in:
 *   - `store.slug` defaulted to `deriveSlug(spec.name)` when empty
 *
 * Throws when no usable slug can be derived — surfacing the problem at
 * publish-time with a message the user can act on, instead of letting the
 * registry return a generic 400.
 */
export function enrichSpecForPublish<T extends AppSpec>(spec: T): T {
  const existingSlug = spec.store?.slug?.trim()
  if (existingSlug) return spec

  const derived = deriveSlug(spec.name)
  if (!derived) {
    throw new Error(
      `Cannot derive a registry slug from name "${spec.name}" ` +
      `(no ASCII alphanumerics). Set spec.store.slug explicitly.`
    )
  }

  return {
    ...spec,
    store: { ...(spec.store ?? {}), slug: derived },
  }
}
