import { beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryR2 } from '~/_lib/memory-r2.ts'

const ROLF = { id: 'u-rolf', email: 'rolf@example.org', name: 'Rolf', role: 'admin' }
vi.mock('~/_lib/require-admin.ts', () => ({ requireAdmin: vi.fn(() => Promise.resolve(ROLF)) }))
vi.mock('~/_lib/neo4j.ts', () => ({ runCypher: vi.fn(() => Promise.resolve([])), runCypherTx: vi.fn() }))
vi.mock('./_apply.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('./_apply.ts')>(),
  applyEntityOps: vi.fn(() => Promise.resolve({ ok: true })),
  checkDrift: vi.fn(() => Promise.resolve([])), checkPropDrift: vi.fn(() => Promise.resolve([])),
  checkDescriptionDrift: vi.fn(() => Promise.resolve([])), checkOpLinks: vi.fn(() => Promise.resolve([])),
  checkEntityExists: vi.fn(() => Promise.resolve(guards.exists ? [{ prop: 'entity', expected: null, actual: 'exists' }] : [])),
}))
const guards = { exists: false }

const listApi    = await import('./index.ts')
const reindexApi = await import('./reindex.ts')
const bundleApi  = await import('./[bundleId].ts')
const accept     = (await import('./[bundleId]/[entityId]/accept.ts')).onRequestPost
const deny       = (await import('./[bundleId]/[entityId]/deny.ts')).onRequestPost
const comments   = await import('./[bundleId]/comments.ts')
const restoreApi = await import('./archive/[bundleId]/restore.ts')
const { rowOf } = await import('../../../../src/utils/bundleIndex.ts')

const id  = (n: number) => `bundle:package-archive-example:2026-10-${String(1 + Math.floor(n / 24)).padStart(2, '0')}T${String(n % 24).padStart(2, '0')}:00:00.000Z`
const B   = id(1)
type Status = 'pending' | 'accepted' | 'denied' | 'drifted'

function manifest(bundleId: string, statuses: Status[], extra: Record<string, unknown> = {}) {
  return {
    bundleId, summary: `Forslag ${bundleId.slice(-24)}`, createdAt: bundleId.slice(-24), model: 'none', promptHash: 'none',
    origin: { type: 'package', site: 'https://archive.example', madeAt: 'x' },
    entities: statuses.map((status, i) => ({ entityId: `Unit:${bundleId.slice(-13, -11)}-e${i}`, status, opSummary: ['create'] })), ...extra,
  }
}
/** Bundles from before the index: manifests and payloads only. */
function oldBundles(n: number, statuses: Status[] = ['pending']) {
  const files: Record<string, unknown> = {}
  for (let i = 0; i < n; i++) {
    const m = manifest(id(i), statuses)
    files[`proposals/bundles/${id(i)}/manifest.json`] = m
    for (const e of m.entities) files[`proposals/bundles/${id(i)}/entity/${e.entityId}.json`] = { entityId: e.entityId, ops: [{ op: 'create-entity' }] }
  }
  return files
}

const env = (bucket: unknown) => ({ PROPOSALS: bucket, SESSION_SECRET: 's' })
const get = (qs = '') => new Request(`https://site.example/x?${qs}`)
const call = (fn: unknown, e: unknown, request: Request, params: Record<string, string> = {}) => (fn as (c: never) => Promise<Response>)({ request, env: e, params, waitUntil: () => {} } as never)
const list = async (e: unknown, qs = '') => (await call(listApi.onRequestGet, e, get(qs))).json<{ bundles: { bundleId: string; status: string; comments: number; counts: Record<string, number> }[]; total: number; facets: { status: Record<string, number>; kinds: string[] } }>()
const rowOf0 = (b: ReturnType<typeof memoryR2>, bundleId: string) => b.meta(`proposals/index/${bundleId}.json`)

let clock = Date.parse('2026-10-09T08:00:00.000Z')
const tick = () => { clock += 1000; vi.setSystemTime(clock) }
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(clock); guards.exists = false })

describe('the list reads the index, not the bundles (#184)', () => {
  it('builds the index from bundles that are from before it, once, and then reads no manifest at all', async () => {
    const bucket = memoryR2(oldBundles(30))
    const first = await list(env(bucket), 'status=all&limit=40')
    expect(first.total).toBe(30)
    expect(bucket.keys('proposals/index/')).toHaveLength(30)

    const reads: string[] = []
    const get0 = bucket.get
    bucket.get = (k: string) => { reads.push(k); return get0(k) }
    const again = await list(env(bucket), 'status=all&limit=40')
    expect(again.total).toBe(30)
    expect(reads).toEqual([])       // not one object read
  })

  it('costs a listing per thousand bundles whatever is in the bundles', async () => {
    // 20 bundles with 50 payloads each: a thousand objects the old endpoint listed and the new one never sees.
    const files = oldBundles(20, Array.from({ length: 50 }, () => 'pending'))
    const bucket = memoryR2(files)
    await list(env(bucket))
    let ops = 0
    for (const m of ['get', 'put', 'list', 'delete'] as const) {
      const f = bucket[m] as (...a: unknown[]) => unknown
      ;(bucket as Record<string, unknown>)[m] = (...a: unknown[]) => { ops++; return f(...a) }
    }
    await list(env(bucket), 'status=all')
    expect(ops).toBe(1)
  })

  it('answers the review queue by default, and filters, sorts and pages on what it is asked', async () => {
    const bucket = memoryR2({})
    const e = env(bucket)
    for (let i = 0; i < 45; i++) bucket.store.set(`proposals/bundles/${id(i)}/manifest.json`, { body: JSON.stringify(manifest(id(i), i % 3 === 0 ? ['accepted'] : ['pending', 'denied'])), etag: 1 })
    await call(reindexApi.onRequestPost, e, new Request('https://site.example/x', { method: 'POST' }))

    const queue = await list(e, 'limit=10')
    expect(queue.total).toBe(30)                                  // the 15 closed ones are not in the queue
    expect(queue.bundles).toHaveLength(10)
    expect(queue.bundles.every(b => b.status === 'pending')).toBe(true)
    expect(queue.bundles[0].bundleId > queue.bundles[9].bundleId).toBe(true)   // newest first
    expect(queue.facets.status).toEqual({ pending: 30, blocked: 0, closed: 15, all: 45 })

    const page3 = await list(e, 'limit=10&offset=20')
    expect(page3.bundles).toHaveLength(10)
    expect((await list(e, 'limit=10&offset=30')).bundles).toHaveLength(0)
    expect((await list(e, 'status=closed&limit=40')).total).toBe(15)
    expect((await list(e, 'status=all&sort=oldest&limit=10')).bundles[0].bundleId).toBe(id(0))
    expect((await list(e, 'q=nothing-matches')).total).toBe(0)
  })

  it('refuses nobody who is an admin, and nobody who is not', async () => {
    const { requireAdmin } = await import('~/_lib/require-admin.ts')
    vi.mocked(requireAdmin).mockResolvedValueOnce(new Response('no', { status: 403 }))
    expect((await call(listApi.onRequestGet, env(memoryR2({})), get())).status).toBe(403)
  })
})

describe('the row follows the bundle', () => {
  async function indexed(statuses: Status[] = ['pending', 'pending']) {
    const bucket = memoryR2({
      [`proposals/bundles/${B}/manifest.json`]: manifest(B, statuses),
      ...Object.fromEntries(statuses.map((_, i) => [`proposals/bundles/${B}/entity/Unit:${B.slice(-13, -11)}-e${i}.json`, { entityId: `Unit:${B.slice(-13, -11)}-e${i}`, ops: [{ op: 'create-entity', kind: 'Unit', slug: 'x', props: {} }] }])),
    })
    await list(env(bucket))
    return { bucket, e: env(bucket), ids: statuses.map((_, i) => `Unit:${B.slice(-13, -11)}-e${i}`) }
  }
  const post = (body: unknown = {}) => new Request('https://site.example/x', { method: 'POST', body: JSON.stringify(body) })

  it('accept: the counts change, and the bundle closes with the last one', async () => {
    const { bucket, e, ids } = await indexed()
    tick(); await call(accept, e, post(), { bundleId: B, entityId: ids[0] })
    expect(rowOf0(bucket, B)).toMatchObject({ status: 'pending', counts: '1,1,0,0' })
    tick(); await call(accept, e, post(), { bundleId: B, entityId: ids[1] })
    expect(rowOf0(bucket, B)).toMatchObject({ status: 'closed', counts: '0,2,0,0' })
    expect((await list(e)).total).toBe(0)                         // out of the review queue
    expect((await list(e, 'status=closed')).total).toBe(1)
  })

  it('deny, and a refusal that sets an entity aside', async () => {
    const { bucket, e, ids } = await indexed()
    tick(); await call(deny, e, post({ reason: 'feil enhet helt' }), { bundleId: B, entityId: ids[0] })
    expect(rowOf0(bucket, B)).toMatchObject({ counts: '1,0,1,0' })
    guards.exists = true
    tick(); await call(accept, e, post(), { bundleId: B, entityId: ids[1] })
    expect(rowOf0(bucket, B)).toMatchObject({ status: 'closed', counts: '0,0,1,1' })
  })

  it('comments are counted, added and removed', async () => {
    const { bucket, e } = await indexed()
    tick(); const added = await (await call(comments.onRequestPost, e, post({ type: 'bundle', text: 'Testbundle.' }), { bundleId: B })).json<{ comment: { id: string } }>()
    expect(rowOf0(bucket, B)).toMatchObject({ comments: '1' })
    expect((await list(e, 'commented=1')).total).toBe(1)
    const removal = await import('./[bundleId]/comments/[commentId].ts')
    tick(); await call(removal.onRequestDelete, e, new Request('https://site.example/x', { method: 'DELETE' }), { bundleId: B, commentId: added.comment.id })
    expect(rowOf0(bucket, B)).toMatchObject({ comments: '0' })
    expect((await list(e, 'commented=1')).total).toBe(0)
  })

  it('archive takes the row away, and restore brings it back', async () => {
    const { bucket, e } = await indexed()
    tick(); await call(bundleApi.onRequestDelete, e, new Request('https://site.example/x', { method: 'DELETE', body: JSON.stringify({ reason: 'Testbundle' }) }), { bundleId: B })
    expect(bucket.keys('proposals/index/')).toEqual([])
    tick(); await call(restoreApi.onRequestPost, e, post(), { bundleId: B })
    expect(rowOf0(bucket, B)).toMatchObject({ bundleId: B, status: 'pending', counts: '2,0,0,0' })
  })

  it('a refresh that fails does not fail what it follows', async () => {
    const { bucket, e, ids } = await indexed()
    const put0 = bucket.put
    bucket.put = ((k: string, v: string, o?: never) => (k.startsWith('proposals/index/') ? Promise.reject(new Error('R2 down')) : put0(k, v, o))) as typeof bucket.put
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    tick(); const res = await call(deny, e, post({ reason: 'feil enhet helt' }), { bundleId: B, entityId: ids[0] })
    expect(res.status).toBe(200)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('not refreshed'), expect.anything())
    log.mockRestore()
  })
})

describe('the rebuild', () => {
  it('writes a row for every bundle, keeps the time of the last change, and drops the row of a bundle that is gone', async () => {
    const bucket = memoryR2(oldBundles(3))
    const e = env(bucket)
    await list(e)
    bucket.store.get(`proposals/index/${id(0)}.json`)!.meta!.updatedAt = '2026-10-09T09:30:00.000Z'   // touched since it was made
    bucket.store.delete(`proposals/bundles/${id(2)}/manifest.json`)                 // gone, row stays
    bucket.store.set(`proposals/bundles/${id(5)}/manifest.json`, { body: JSON.stringify(manifest(id(5), ['accepted'])), etag: 1 })   // new, no row
    const res = await call(reindexApi.onRequestPost, e, new Request('https://site.example/x', { method: 'POST' }))
    expect(await res.json()).toMatchObject({ ok: true, rows: 3, removed: 1 })
    expect(bucket.keys('proposals/index/')).toEqual([id(0), id(1), id(5)].map(i => `proposals/index/${i}.json`))
    expect(rowOf0(bucket, id(0))).toMatchObject({ updatedAt: '2026-10-09T09:30:00.000Z' })
  })

  it('a row has what the list needs and fits R2\'s metadata', () => {
    const r = rowOf(manifest(id(1), ['pending']), { source: 's', originKind: 'package', comments: 0, updatedAt: 'x' })
    expect(r.kinds).toEqual(['Unit'])
  })
})
