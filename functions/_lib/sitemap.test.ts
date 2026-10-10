import { describe, expect, it, vi } from 'vitest'
import { opsChangeUrls, canonicalPath, entityPath, normalizePath, readSitemap, renderSitemap, SITEMAP_KEY, MAX_AGE_MS } from './sitemap.ts'

describe('normalizePath', () => {
  it('makes encoded and plain æøå, case and trailing slash agree', () => {
    expect(normalizePath('/person/k%C3%A5re/')).toBe(normalizePath('/Person/kåre'))
    expect(normalizePath('/person/kåre')).toBe('/person/kåre')
  })
  it('drops query and hash, and survives a broken escape', () => {
    expect(normalizePath('/person/x?a=1#b')).toBe('/person/x')
    expect(normalizePath('/person/%E0%A4')).toBe('/person/%e0%a4')
  })
  it('keeps the root', () => { expect(normalizePath('/')).toBe('/') })
})

describe('entityPath', () => {
  it('reduces a child page to its entity', () => {
    expect(entityPath('/person/linge/medlemmer')).toBe('/person/linge')
    expect(entityPath('/map/some-place/x')).toBe('/map/some-place')
  })
  it('treats /location/ as /map/', () => { expect(entityPath('/location/foo')).toBe('/map/foo') })
  it('ignores everything that is not an entity page', () => {
    for (const p of ['/', '/people', '/api/neo4j/query', '/auth/me', '/admin/users', '/assets/a.js', '/person', '/events']) {
      expect(entityPath(p)).toBeNull()
    }
  })
  it('never treats the create form as an entity', () => {
    expect(entityPath('/person/new')).toBeNull()
    expect(entityPath('/district/new')).toBeNull()
  })
})

describe('canonicalPath', () => {
  it('percent-encodes the slug', () => { expect(canonicalPath('/person/', 'kåre')).toBe('/person/k%C3%A5re') })
})

describe('renderSitemap', () => {
  it('writes one absolute URL per line', () => {
    expect(renderSitemap(['/', '/person/a'], 'https://x.test')).toBe('https://x.test/\nhttps://x.test/person/a\n')
  })
})

function fakeKv(value: string | null, builtAt: number) {
  return {
    getWithMetadata: vi.fn(() => Promise.resolve({ value, metadata: { builtAt } })),
    put: vi.fn(() => Promise.resolve()),
  } as unknown as KVNamespace
}

describe('readSitemap', () => {
  it('returns null (fail open) without a binding', async () => {
    expect(await readSitemap({}, () => {})).toBeNull()
  })
  it('returns null when the key is missing and the graph is not configured', async () => {
    expect(await readSitemap({ SITEMAP: fakeKv(null, 0) }, () => {})).toBeNull()
  })
  it('serves a stale list and schedules a rebuild', async () => {
    const kv = fakeKv('/person/a\n/district/b', Date.now() - MAX_AGE_MS - 1)
    const scheduled: Promise<unknown>[] = []
    const s = await readSitemap({ SITEMAP: kv }, p => scheduled.push(p))
    expect(s?.known.has('/person/a')).toBe(true)
    expect(scheduled).toHaveLength(1)
    await Promise.all(scheduled)
    expect(SITEMAP_KEY).toBe('sitemap')
  })
})

describe('opsChangeUrls', () => {
  it('is true for create, delete and a slug change', () => {
    expect(opsChangeUrls([{ op: 'create-entity' }])).toBe(true)
    expect(opsChangeUrls([{ op: 'add-edge' }, { op: 'delete-entity' }])).toBe(true)
    expect(opsChangeUrls([{ op: 'set-props', props: { slug: { from: 'a', to: 'b' } } }])).toBe(true)
  })
  it('is false for edits that leave the set of URLs alone', () => {
    expect(opsChangeUrls([{ op: 'modify-block' }, { op: 'set-kind' }, { op: 'obsolete-outline' }])).toBe(false)
    expect(opsChangeUrls([{ op: 'set-props', props: { date: { from: null, to: '1944' } } }])).toBe(false)
  })
})
