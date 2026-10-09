import { describe, expect, it } from 'vitest'
import { DEFAULT_QUERY, fromMetadata, parseQuery, queryRows, rowOf, toMetadata, toParams, type BundleRow } from './bundleIndex.ts'

const manifest = (id: string, statuses: string[], extra = {}) => ({
  bundleId: id, summary: `Forslag ${id}`, createdAt: `2026-10-0${id.slice(-1)}T07:00:00.000Z`, model: 'none',
  entities: statuses.map((status, i) => ({ entityId: `${i % 2 ? 'Person' : 'Unit'}:e${i}`, status })), ...extra,
})
const row = (id: string, statuses: string[], over: Partial<BundleRow> = {}, extra = {}): BundleRow =>
  ({ ...rowOf(manifest(id, statuses, extra), { source: 'package from https://a.example', originKind: 'package', comments: 0, updatedAt: `2026-10-0${id.slice(-1)}T09:00:00.000Z` }), ...over })

describe('rowOf', () => {
  it('derives the status and the counts from the entities, the kinds once each, and carries the rest', () => {
    const r = row('b1', ['accepted', 'pending', 'denied'], {}, { parentBundle: 'p' })
    expect(r).toMatchObject({ status: 'pending', counts: { pending: 1, accepted: 1, denied: 1, drifted: 0 }, entities: 3, kinds: ['Person', 'Unit'], child: true, outlineId: null })
    expect(row('b2', ['accepted']).status).toBe('closed')
  })
})

describe('the metadata of an index object', () => {
  it('is only strings, comes back as the row, and stays under 2 KB whatever the texts are', () => {
    const r = row('b1', ['pending', 'denied'], { summary: 'å'.repeat(5000), source: 'ø'.repeat(500), comments: 3, kinds: Array.from({ length: 40 }, (_, i) => `Kind${i}`) })
    const meta = toMetadata(r)
    expect(Object.values(meta).every(v => typeof v === 'string')).toBe(true)
    expect(new TextEncoder().encode(Object.entries(meta).flat().join('')).length).toBeLessThan(2048)
    expect(fromMetadata(toMetadata(row('b1', ['pending', 'denied'], { comments: 3 })))).toEqual(row('b1', ['pending', 'denied'], { comments: 3 }))
  })
  it('is not read from metadata that is not a row\'s', () => {
    expect(fromMetadata(undefined)).toBeNull()
    expect(fromMetadata({ type: 'bundle' })).toBeNull()
  })
})

describe('parseQuery and toParams', () => {
  it('is the review queue, 20 a page, newest first, by default', () => {
    expect(parseQuery(new URLSearchParams())).toEqual(DEFAULT_QUERY)
    expect(DEFAULT_QUERY).toMatchObject({ status: 'pending', limit: 20, sort: 'newest' })
  })
  it('reads what is asked and takes the default for what is wrong, so a stale link still opens', () => {
    expect(parseQuery(new URLSearchParams('status=closed&origin=outline&kind=Unit&q=linge&commented=1&sort=oldest&limit=40&offset=40')))
      .toEqual({ status: 'closed', origin: 'outline', kind: 'Unit', q: 'linge', commented: true, sort: 'oldest', limit: 40, offset: 40 })
    expect(parseQuery(new URLSearchParams('status=nope&origin=x&kind=a;b&limit=7&offset=-3&sort=?')))
      .toEqual(DEFAULT_QUERY)
  })
  it('writes only what differs from the default, and reads back what it wrote', () => {
    expect(toParams(DEFAULT_QUERY).toString()).toBe('')
    const q = { ...DEFAULT_QUERY, status: 'all' as const, q: 'berit', limit: 10, offset: 10, commented: true }
    expect(parseQuery(toParams(q))).toEqual(q)
  })
})

describe('queryRows', () => {
  const rows = [
    row('b1', ['pending', 'pending'], { comments: 2 }),
    row('b2', ['accepted']),
    row('b3', ['denied', 'pending'], { originKind: 'outline', source: 'outline linge-pulje-4', outlineId: 'linge-pulje-4', summary: 'Kompani Linge, pulje 4' }),
    row('b4', ['accepted', 'accepted'], { status: 'blocked' as const }),
  ]
  const ids = (q: Partial<typeof DEFAULT_QUERY>) => queryRows(rows, { ...DEFAULT_QUERY, ...q }).bundles.map(b => b.bundleId)

  it('shows the review queue by default: what still waits', () => expect(ids({})).toEqual(['b3', 'b1']))
  it('filters on status, with «alle» as all', () => {
    expect(ids({ status: 'closed' })).toEqual(['b2'])
    expect(ids({ status: 'blocked' })).toEqual(['b4'])
    expect(ids({ status: 'all' })).toEqual(['b4', 'b3', 'b2', 'b1'])
  })
  it('filters on where it came from, on the kind of entity, and on whether it has a comment', () => {
    expect(ids({ status: 'all', origin: 'outline' })).toEqual(['b3'])
    expect(ids({ status: 'all', kind: 'Person' })).toEqual(['b4', 'b3', 'b1'])   // the ones with two or more entities have one
    expect(ids({ status: 'all', kind: 'Article' })).toEqual([])
    expect(ids({ status: 'all', commented: true })).toEqual(['b1'])
  })
  it('finds text in the summary, the id, the origin and the outline, ignoring case', () => {
    expect(ids({ status: 'all', q: 'LINGE' })).toEqual(['b3'])
    expect(ids({ status: 'all', q: 'forslag b2' })).toEqual(['b2'])
    expect(ids({ status: 'all', q: 'pulje-4' })).toEqual(['b3'])
  })
  it('sorts newest first, oldest first, most pending first, and most recently touched', () => {
    expect(ids({ status: 'all', sort: 'oldest' })).toEqual(['b1', 'b2', 'b3', 'b4'])
    expect(ids({ status: 'all', sort: 'pending' })[0]).toBe('b1')
    expect(ids({ status: 'all', sort: 'touched' })).toEqual(['b4', 'b3', 'b2', 'b1'])
  })
  it('pages, with the total of what matches before paging', () => {
    const a = queryRows(rows, { ...DEFAULT_QUERY, status: 'all', limit: 10, offset: 0 })
    expect(a.total).toBe(4)
    const many = Array.from({ length: 25 }, (_, i) => row(`b${i}`.padEnd(3, '0'), ['pending']))
    const p1 = queryRows(many, { ...DEFAULT_QUERY, limit: 10, offset: 0 })
    const p3 = queryRows(many, { ...DEFAULT_QUERY, limit: 10, offset: 20 })
    expect([p1.bundles.length, p3.bundles.length, p1.total, p3.total]).toEqual([10, 5, 25, 25])
  })
  it('counts the whole list by status and lists the kinds, whatever the filter is', () => {
    const a = queryRows(rows, { ...DEFAULT_QUERY, q: 'linge' })
    expect(a.facets).toEqual({ status: { pending: 2, blocked: 1, closed: 1, all: 4 }, kinds: ['Person', 'Unit'] })
  })
})
