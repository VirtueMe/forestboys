import { beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryR2 } from '~/_lib/memory-r2.ts'

const ROLF = { id: 'u-rolf', email: 'rolf@example.org', name: 'Rolf', role: 'admin' }
vi.mock('~/_lib/require-admin.ts', () => ({ requireAdmin: vi.fn(() => Promise.resolve(ROLF)) }))
vi.mock('~/_lib/neo4j.ts', () => ({ runCypher: vi.fn(() => Promise.resolve([])), runCypherTx: vi.fn() }))

const { requireAdmin } = await import('~/_lib/require-admin.ts')
const bundleApi = await import('./[bundleId].ts')
const listApi   = await import('./archive/index.ts')
const readApi   = await import('./archive/[bundleId].ts')
const restoreApi = await import('./archive/[bundleId]/restore.ts')
const commentsApi = await import('./[bundleId]/comments.ts')
const { listEvents } = await import('~/_lib/bundle-events.ts')

const B   = 'bundle:package-archive-example:2026-10-08T07:00:00.000Z'
const key = (rest: string) => `proposals/bundles/${B}/${rest}`
const SRC = 'proposals/by-source/package-archive-example/index.json'

type Status = 'pending' | 'accepted' | 'denied' | 'drifted'
function setup(entities: [string, Status][] = [['Unit:a', 'pending'], ['Unit:b', 'denied']], id = B) {
  const files: Record<string, unknown> = {
    [`proposals/bundles/${id}/manifest.json`]: { bundleId: id, summary: 'Test', createdAt: '2026-10-08T07:00:00.000Z', model: 'none', promptHash: 'none', origin: { type: 'package', site: 'https://archive.example', madeAt: 'x' }, entities: entities.map(([entityId, status]) => ({ entityId, status, opSummary: ['create'] })) },
    [SRC]: { bundleIds: [id] },
  }
  for (const [entityId, status] of entities) {
    files[`proposals/bundles/${id}/entity/${entityId}.json`] = { entityId, ops: [{ op: 'create-entity' }] }
    if (status === 'pending') files[`proposals/by-entity/${entityId}/index.json`] = { bundleIds: [id] }
  }
  const bucket = memoryR2(files)
  return { bucket, env: { PROPOSALS: bucket, SESSION_SECRET: 's' } }
}

const req = (method: string, body?: unknown) => new Request('https://site.example/x', { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
const call = (fn: unknown, env: unknown, request: Request, id = B) => (fn as (c: never) => Promise<Response>)({ request, env, params: { bundleId: id } } as never)
const archive = (env: unknown, reason: unknown = 'Testbundle, ikke i bruk', id = B) => call(bundleApi.onRequestDelete, env, req('DELETE', { reason }), id)
const restore = (env: unknown, reason?: unknown, id = B) => call(restoreApi.onRequestPost, env, req('POST', reason === undefined ? undefined : { reason }), id)
const indexOf = (b: ReturnType<typeof memoryR2>, k: string) => (b.json(k) as { bundleIds: string[] }).bundleIds

// Things done one after the other happen at different times; the order of the log is the order of the clock.
let clock = Date.parse('2026-10-09T08:00:00.000Z')
const tick = () => { clock += 1000; vi.setSystemTime(clock) }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(clock)
  vi.mocked(requireAdmin).mockResolvedValue(ROLF)
})

describe('«Slett» archives (#188)', () => {
  it('keeps the whole bundle in one object, with who, when and why, and takes it off the lists', async () => {
    const { bucket, env } = setup()
    const before = bucket.keys(key('')).map((k): [string, unknown] => [k, bucket.json(k)])
    const res = await archive(env)
    expect(res.status).toBe(200)

    expect(bucket.keys(key(''))).toEqual([])                                   // nothing is left under the bundle
    expect(indexOf(bucket, SRC)).toEqual([])                                   // off the lists of open bundles
    expect(indexOf(bucket, 'proposals/by-entity/Unit:a/index.json')).toEqual([])

    const kept = bucket.json(`proposals/archive/${B}.json`) as { archivedBy: string; reason: string; archivedAt: string; restorable: boolean; objects: Record<string, { value: unknown }> }
    expect(kept).toMatchObject({ archivedBy: 'Rolf', reason: 'Testbundle, ikke i bruk', restorable: true })
    expect(kept.archivedAt).toMatch(/^2026-/)
    for (const [k, v] of before) expect(kept.objects[k.slice(`proposals/bundles/${B}/`.length)].value).toEqual(v)   // every object is in it
  })

  it('writes the reason as a comment on the bundle, with a pointer in the log, and it is still there after a restore', async () => {
    const { bucket, env } = setup()
    await archive(env, 'Testbundle, ikke i bruk')
    const kept = bucket.json(`proposals/archive/${B}.json`) as { objects: Record<string, { value: { text?: string; kind?: string }; customMetadata?: Record<string, string> }> }
    const comments = Object.entries(kept.objects).filter(([k]) => k.startsWith('comments/'))
    expect(comments).toHaveLength(1)
    expect(comments[0][1]).toMatchObject({ value: { text: 'Arkivert: Testbundle, ikke i bruk', type: 'bundle', actor: { name: 'Rolf' } }, customMetadata: { type: 'bundle' } })
    tick()
    await restore(env)
    const thread = await (await call(commentsApi.onRequestGet, env, new Request('https://site.example/x?type=bundle'))).json<{ comments: { text: string }[] }>()
    expect(thread.comments.map(c => c.text)).toEqual(['Arkivert: Testbundle, ikke i bruk'])
  })

  it('refuses without a reason, and then changes nothing', async () => {
    const { bucket, env } = setup()
    const before = bucket.keys('')
    expect((await archive(env, '')).status).toBe(400)
    expect((await archive(env, 'ok')).status).toBe(400)
    expect(bucket.keys('')).toEqual(before)
  })

  it('answers 404 for a bundle that is not there, and 403 for someone who is not an admin', async () => {
    const { bucket, env } = setup()
    expect((await archive(env, 'Testbundle', 'bundle:other:2026-10-08T07:00:00.000Z')).status).toBe(404)
    vi.mocked(requireAdmin).mockResolvedValueOnce(new Response('no', { status: 403 }))
    expect((await archive(env)).status).toBe(403)
    expect(bucket.keys(key('manifest.json'))).toHaveLength(1)
  })
})

describe('finding it again', () => {
  it('lists the archive from the metadata alone: no archived bundle is read', async () => {
    const { bucket, env } = setup()
    await archive(env)
    const reads: string[] = []
    const get0 = bucket.get
    bucket.get = (k: string) => { reads.push(k); return get0(k) }
    const { bundles } = await (await call(listApi.onRequestGet, env, req('GET'))).json<{ bundles: Record<string, unknown>[] }>()
    expect(bundles).toMatchObject([{ bundleId: B, summary: 'Test', archivedBy: 'Rolf', reason: 'Testbundle, ikke i bruk', status: 'pending', entities: 2, counts: { pending: 1, denied: 1, accepted: 0, drifted: 0 }, restorable: true }])
    expect(reads.filter(k => k.startsWith('proposals/archive/'))).toEqual([])
  })

  it('reads one read-only: the manifest, the log (with the archiving in it) and the comments', async () => {
    const { env } = setup()
    await call(commentsApi.onRequestPost, env, req('POST', { type: 'bundle', text: 'Test, slett etterpå.' }))
    tick()
    await archive(env)
    const body = await (await call(readApi.onRequestGet, env, req('GET'))).json<{ archive: { reason: string }; manifest: { entities: unknown[] }; events: { kind: string }[]; comments: { text: string }[] }>()
    expect(body.archive.reason).toBe('Testbundle, ikke i bruk')
    expect(body.manifest.entities).toHaveLength(2)
    expect(body.events.map(e => e.kind)).toEqual(['commented', 'commented', 'archived'])
    expect(body.comments.map(c => c.text)).toEqual(['Test, slett etterpå.', 'Arkivert: Testbundle, ikke i bruk'])
  })

  it('answers 404 for a bundle that is not archived', async () => {
    const { env } = setup()
    expect((await call(readApi.onRequestGet, env, req('GET'))).status).toBe(404)
  })
})

describe('restore', () => {
  it('puts every object back as it was, the pending entities back on the lists, and says so in the log', async () => {
    const { bucket, env } = setup()
    const before = Object.fromEntries(bucket.keys(key('')).map(k => [k, bucket.json(k)]))
    await call(commentsApi.onRequestPost, env, req('POST', { type: 'entity', entityId: 'Unit:a', text: 'Om a.' }))
    tick()
    await archive(env)
    tick()
    const res = await restore(env)
    expect(res.status).toBe(200)

    for (const [k, v] of Object.entries(before)) expect(bucket.json(k)).toEqual(v)
    expect(indexOf(bucket, SRC)).toEqual([B])
    expect(indexOf(bucket, 'proposals/by-entity/Unit:a/index.json')).toEqual([B])
    expect(bucket.keys('proposals/archive/')).toEqual([])

    const comment = bucket.keys(key('comments/'))[0]
    expect(bucket.meta(comment)).toEqual({ type: 'entity', entityId: 'Unit:a' })   // the metadata the counts read comes back
    expect((await listEvents(bucket as never, B)).map(e => e.kind)).toEqual(['commented', 'commented', 'archived', 'restored'])
  })

  it('takes an optional reason: a comment on the bundle after the one that archived it, and the log says why', async () => {
    const { bucket, env } = setup()
    await archive(env)
    tick()
    expect((await restore(env, 'Rolf trenger den likevel')).status).toBe(200)
    const thread = await (await call(commentsApi.onRequestGet, env, new Request('https://site.example/x?type=bundle'))).json<{ comments: { text: string }[] }>()
    expect(thread.comments.map(c => c.text)).toEqual(['Arkivert: Testbundle, ikke i bruk', 'Gjenopprettet: Rolf trenger den likevel'])
    const events = await listEvents(bucket as never, B)
    expect(events.map(e => e.kind)).toEqual(['commented', 'archived', 'restored', 'commented'])
    expect(events[2]).toMatchObject({ kind: 'restored', reason: 'Rolf trenger den likevel', actor: { name: 'Rolf' } })
  })

  it('needs none: a restore without a reason, or with a blank one, writes no comment', async () => {
    const { bucket, env } = setup()
    await archive(env)
    tick()
    expect((await restore(env, '   ')).status).toBe(200)
    expect(bucket.keys(key('comments/'))).toHaveLength(1)   // only the one that archived it
    expect((await listEvents(bucket as never, B)).find(e => e.kind === 'restored')).not.toHaveProperty('reason')
  })

  it('refuses a reason that is too long, and then changes nothing', async () => {
    const { bucket, env } = setup()
    await archive(env)
    expect((await restore(env, 'x'.repeat(501))).status).toBe(400)
    expect(bucket.keys(key(''))).toEqual([])
    expect(bucket.keys('proposals/archive/')).toHaveLength(1)
  })

  it('refuses a bundle with an accepted entity: its ops are in the graph, so it stays an archived record', async () => {
    const { bucket, env } = setup([['Unit:a', 'accepted'], ['Unit:b', 'pending']])
    await archive(env)
    expect((await restore(env)).status).toBe(409)
    expect(bucket.keys(key(''))).toEqual([])
    expect(bucket.keys('proposals/archive/')).toHaveLength(1)
  })

  it('refuses when a bundle with the same id is there already (sent again after it was archived)', async () => {
    const { bucket, env } = setup()
    await archive(env)
    bucket.store.set(key('manifest.json'), { body: '{}', etag: 1 })
    expect((await restore(env)).status).toBe(409)
    expect(bucket.keys('proposals/archive/')).toHaveLength(1)
  })

  it('answers 404 for a bundle that is not archived', async () => {
    const { env } = setup()
    expect((await restore(env)).status).toBe(404)
  })
})

describe('purge', () => {
  it('removes the archived bundle for good, with a reason, and leaves a short record of who, when and why', async () => {
    const { bucket, env } = setup()
    await archive(env)
    expect((await call(readApi.onRequestDelete, env, req('DELETE', {}))).status).toBe(400)
    expect(bucket.keys('proposals/archive/')).toHaveLength(1)

    expect((await call(readApi.onRequestDelete, env, req('DELETE', { reason: 'Prøvedata, trengs ikke mer' }))).status).toBe(200)
    expect(bucket.keys('proposals/archive/')).toEqual([])
    expect(bucket.json(`proposals/purged/${B}.json`)).toMatchObject({ bundleId: B, summary: 'Test', archivedBy: 'Rolf', purgedBy: { name: 'Rolf' }, purgeReason: 'Prøvedata, trengs ikke mer' })
    expect(JSON.stringify(bucket.json(`proposals/purged/${B}.json`))).not.toContain('"objects"')
  })
})

describe('a bundle with many entities: the number of operations is bounded', () => {
  /** The bucket with a counter on every call the Worker makes to R2. */
  function counted(entities: [string, Status][]) {
    const s = setup(entities)
    const counter = { n: 0 }
    for (const m of ['get', 'put', 'list', 'delete'] as const) {
      const f = s.bucket[m] as (...a: unknown[]) => unknown
      ;(s.bucket as Record<string, unknown>)[m] = (...a: unknown[]) => { counter.n++; return f(...a) }
    }
    return { ...s, counter }
  }
  const many = (n: number): [string, Status][] => Array.from({ length: n }, (_, i) => [`Article:a${i}`, 'pending'])

  it('archives and restores the biggest bundle of #158 (287 entities, all pending) in fewer than a thousand operations', async () => {
    const { bucket, env, counter } = counted(many(287))
    expect((await archive(env)).status).toBe(200)
    expect(counter.n).toBeLessThan(950)
    expect(bucket.keys(key(''))).toEqual([])

    counter.n = 0
    expect((await restore(env)).status).toBe(200)
    expect(counter.n).toBeLessThan(950)
    expect(bucket.keys(key('entity/'))).toHaveLength(287)
    expect(indexOf(bucket, 'proposals/by-entity/Article:a286/index.json')).toEqual([B])
  })

  it('refuses a bundle that would not fit, before it changes anything', async () => {
    const { bucket, env } = counted(many(600))
    const before = bucket.keys('')
    const res = await archive(env)
    expect(res.status).toBe(413)
    expect((await res.json<{ error: string }>()).error).toContain('too big')
    expect(bucket.keys('')).toEqual(before)   // not a comment, not an event: exactly as it was
    expect(bucket.keys('proposals/archive/')).toEqual([])
  })
})
