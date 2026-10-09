import { beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryR2 } from '~/_lib/memory-r2.ts'

// The user who acts, the graph and the apply are replaced; R2 is real (in memory), because the log is what is checked (#190).
const ROLF = { id: 'u-rolf', email: 'rolf@example.org', name: 'Rolf', role: 'admin' }
vi.mock('~/_lib/require-admin.ts', () => ({ requireAdmin: vi.fn(() => Promise.resolve(ROLF)) }))
vi.mock('~/_lib/neo4j.ts', () => ({ runCypher: vi.fn(() => Promise.resolve([])), runCypherTx: vi.fn() }))
const guards = { exists: false }
vi.mock('./_apply.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('./_apply.ts')>(),
  applyEntityOps:           vi.fn(() => Promise.resolve({ ok: true })),
  checkDrift:               vi.fn(() => Promise.resolve([])),
  checkPropDrift:           vi.fn(() => Promise.resolve([])),
  checkDescriptionDrift:    vi.fn(() => Promise.resolve([])),
  checkOpLinks:             vi.fn(() => Promise.resolve([])),
  checkEntityExists:        vi.fn(() => Promise.resolve(guards.exists ? [{ prop: 'entity', expected: null, actual: 'exists' }] : [])),
}))

const { requireAdmin } = await import('~/_lib/require-admin.ts')
const accept    = (await import('./[bundleId]/[entityId]/accept.ts')).onRequestPost
const deny      = (await import('./[bundleId]/[entityId]/deny.ts')).onRequestPost
const acceptAll = (await import('./[bundleId]/accept-all.ts')).onRequestPost
const bundleApi = await import('./[bundleId].ts')
const { listEvents } = await import('~/_lib/bundle-events.ts')

const B   = 'bundle:package-archive-example:2026-10-08T07:00:00.000Z'
const key = (rest: string) => `proposals/bundles/${B}/${rest}`
const ent = (entityId: string, status = 'pending') => ({ entityId, status, opSummary: ['create'] })
const payload = (entityId: string) => ({ entityId, ops: [{ op: 'create-entity', kind: 'Unit', slug: entityId.split(':')[1], props: {} }], derivedFrom: {}, source: 's', generatedAt: 'x' })

function setup(ids = ['Unit:a', 'Unit:b']) {
  const bucket = memoryR2({
    [key('manifest.json')]: { bundleId: B, summary: 'Test', createdAt: 'x', model: 'none', promptHash: 'none', origin: { type: 'package', site: 'https://archive.example', madeAt: 'x' }, entities: ids.map(i => ent(i)) },
    ...Object.fromEntries(ids.map(i => [key(`entity/${i}.json`), payload(i)])),
  })
  return { bucket, env: { PROPOSALS: bucket, SESSION_SECRET: 's' } }
}
const post = (body: unknown = {}) => new Request('https://site.example/x', { method: 'POST', body: JSON.stringify(body) })
const ctx = (env: unknown, entityId?: string, request = post()) => ({ request, env, params: { bundleId: B, ...(entityId ? { entityId } : {}) } }) as never

beforeEach(() => { guards.exists = false })

describe('what an action leaves in the log (#190)', () => {
  it('accept: an event with the user, the message and the ops, and the user on the accepted record', async () => {
    const { bucket, env } = setup()
    const res = await accept(ctx(env, 'Unit:a', post({ message: 'ser riktig ut' })))
    expect(res.status).toBe(200)
    const events = await listEvents(bucket as never, B)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'accepted', entityId: 'Unit:a', message: 'ser riktig ut', summary: ['create'], actor: { name: 'Rolf', id: 'u-rolf' } })
    expect(JSON.stringify(events[0])).not.toContain('example.org')
    const record = bucket.json(bucket.keys(key('accepted/'))[0])
    expect(record).toMatchObject({ entityId: 'Unit:a', actor: { name: 'Rolf' } })
  })

  it('deny: an event with the reason, and the user on the denied record', async () => {
    const { bucket, env } = setup()
    const res = await deny(ctx(env, 'Unit:a', post({ reason: 'feil enhet helt' })))
    expect(res.status).toBe(200)
    expect(await listEvents(bucket as never, B)).toMatchObject([{ kind: 'denied', entityId: 'Unit:a', reason: 'feil enhet helt', actor: { name: 'Rolf' } }])
    expect(bucket.json(bucket.keys(key('denied/'))[0])).toMatchObject({ actor: { name: 'Rolf' } })
  })

  it('refusal: what was refused and why, in words, and the entity is set aside', async () => {
    guards.exists = true
    const { bucket, env } = setup()
    const res = await accept(ctx(env, 'Unit:a'))
    expect(res.status).toBe(409)
    expect(await listEvents(bucket as never, B)).toMatchObject([{ kind: 'refused', entityId: 'Unit:a', why: 'Finnes allerede i grafen. Satt til side.', actor: { name: 'Rolf' } }])
  })

  it('accept-all: one event for the run, with what it accepted and what it refused', async () => {
    const { bucket, env } = setup(['Unit:a', 'Unit:b', 'Unit:c'])
    const { checkEntityExists } = await import('./_apply.ts')
    vi.mocked(checkEntityExists).mockImplementation((_e, id) => Promise.resolve(id === 'Unit:b' ? [{ prop: 'entity', expected: null, actual: 'exists' }] : []))
    const res = await acceptAll(ctx(env))
    expect(res.status).toBe(200)
    const events = await listEvents(bucket as never, B)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'accepted-all', accepted: ['Unit:a', 'Unit:c'], refused: [{ entityId: 'Unit:b', why: 'Finnes allerede i grafen.' }], actor: { name: 'Rolf' } })
  })

  it('two editors acting at once on different entities: both events are there', async () => {
    const { bucket, env } = setup()
    const { requireAdmin: guard } = await import('~/_lib/require-admin.ts')
    vi.mocked(guard).mockResolvedValueOnce({ ...ROLF, name: 'Rolf' }).mockResolvedValueOnce({ ...ROLF, id: 'u-jan', name: 'Jan' })
    await Promise.all([accept(ctx(env, 'Unit:a')), deny(ctx(env, 'Unit:b', post({ reason: 'hører ikke hjemme her' })))])
    const events = await listEvents(bucket as never, B)
    expect(events.map(e => e.kind).sort()).toEqual(['accepted', 'denied'])
    expect(events.map(e => 'name' in e.actor && e.actor.name).sort()).toEqual(['Jan', 'Rolf'])
  })

  it('delete archives: the log goes into the archive with who, when and why, and the bundle leaves its prefix', async () => {
    const { bucket, env } = setup()
    await deny(ctx(env, 'Unit:a', post({ reason: 'feil enhet helt' })))
    expect(bucket.keys(key('events/'))).toHaveLength(1)
    const res = await bundleApi.onRequestDelete(ctx(env, undefined, new Request('https://site.example/x', { method: 'DELETE', body: JSON.stringify({ reason: 'Testbundle, ikke i bruk' }) })))
    expect(res.status).toBe(200)
    expect(bucket.keys(`proposals/bundles/${B}/`)).toEqual([])
    const archive = bucket.json(`proposals/archive/${B}.json`) as { archivedBy: string; archivedById: string; reason: string; objects: Record<string, { value: Record<string, unknown> }> }
    expect(archive).toMatchObject({ bundleId: B, summary: 'Test', archivedBy: 'Rolf', archivedById: 'u-rolf', reason: 'Testbundle, ikke i bruk' })
    const kinds = Object.entries(archive.objects).filter(([k]) => k.startsWith('events/')).map(([, o]) => o.value.kind).sort()
    expect(kinds).toEqual(['archived', 'commented', 'denied'])
  })

  it('the bundle page gets the log with the bundle', async () => {
    const { env } = setup()
    await deny(ctx(env, 'Unit:a', post({ reason: 'feil enhet helt' })))
    const body = await (await bundleApi.onRequestGet(ctx(env, undefined, new Request('https://site.example/x')))).json<{ events: { kind: string }[] }>()
    expect(body.events.map(e => e.kind)).toEqual(['denied'])
  })

  it('a refused login leaves nothing', async () => {
    const { bucket, env } = setup()
    vi.mocked(requireAdmin).mockResolvedValueOnce(new Response('no', { status: 403 }))
    expect((await deny(ctx(env, 'Unit:a', post({ reason: 'feil enhet helt' })))).status).toBe(403)
    expect(bucket.keys(key('events/'))).toEqual([])
  })
})
