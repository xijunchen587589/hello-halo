/**
 * Tests for pre-publish spec enrichment.
 *
 * The derivation logic MUST stay in sync with the Go implementation in
 * digital-human-protocol/server/internal/spec/spec.go (DeriveSlug).
 */

import { describe, it, expect } from 'vitest'
import { deriveSlug, enrichSpecForPublish } from '../../../src/main/store/publish/spec-enrich'
import type { AppSpec } from '../../../src/main/apps/spec/schema'

function fakeSpec(overrides: Partial<AppSpec> = {}): AppSpec {
  return {
    spec_version: '1',
    name: 'HN Daily',
    version: '1.0.0',
    author: 'tester',
    description: 'd',
    type: 'automation',
    system_prompt: 'p',
    subscriptions: [],
    ...overrides,
  } as AppSpec
}

describe('deriveSlug', () => {
  const cases: Array<[string, string]> = [
    ['hn-daily', 'hn-daily'],
    ['HN Daily', 'hn-daily'],
    ['  My  App  ', 'my-app'],
    ['Foo!!! Bar???', 'foo-bar'],
    ['Already-Slug', 'already-slug'],
    ['foo--bar', 'foo-bar'],
    ['---weird---', 'weird'],
    ['v2.1 release', 'v2-1-release'],
    ['中文名', ''],
    ['中文 mixed Name', 'mixed-name'],
  ]
  for (const [input, want] of cases) {
    it(`${JSON.stringify(input)} → ${JSON.stringify(want)}`, () => {
      expect(deriveSlug(input)).toBe(want)
    })
  }
})

describe('enrichSpecForPublish', () => {
  it('passes through specs that already carry store.slug', () => {
    const spec = fakeSpec({ store: { slug: 'tester/hn-daily', tags: [] } })
    const out = enrichSpecForPublish(spec)
    expect(out.store?.slug).toBe('tester/hn-daily')
  })

  it('derives store.slug from name when missing', () => {
    const spec = fakeSpec({ name: 'HN Daily' })
    const out = enrichSpecForPublish(spec)
    expect(out.store?.slug).toBe('hn-daily')
  })

  it('preserves other store fields while filling in slug', () => {
    const spec = fakeSpec({
      name: 'My App',
      store: { tags: ['news'], category: 'tools' },
    } as Partial<AppSpec>)
    const out = enrichSpecForPublish(spec)
    expect(out.store?.slug).toBe('my-app')
    expect(out.store?.tags).toEqual(['news'])
    expect(out.store?.category).toBe('tools')
  })

  it('treats whitespace-only slug as missing', () => {
    const spec = fakeSpec({ name: 'HN Daily', store: { slug: '   ', tags: [] } })
    const out = enrichSpecForPublish(spec)
    expect(out.store?.slug).toBe('hn-daily')
  })

  it('throws when no usable slug can be derived', () => {
    const spec = fakeSpec({ name: '中文名' })
    expect(() => enrichSpecForPublish(spec)).toThrow(/中文名/)
  })

  it('does not mutate the input spec', () => {
    const spec = fakeSpec({ name: 'HN Daily' })
    enrichSpecForPublish(spec)
    expect(spec.store).toBeUndefined()
  })
})
