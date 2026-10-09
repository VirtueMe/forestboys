import { beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryR2 } from '~/_lib/memory-r2.ts'

const ROLF = { id: 'u-rolf', email: 'rolf@example.org', name: 'Rolf', role: 'admin' }
vi.mock('~/_lib/require-admin.ts', () => ({ requireAdmin: vi.fn(() => Promise.resolve(ROLF)) }))

const { requireAdmin } = await import('~/_lib/require-admin.ts')
const comments  = await import('./[bundleId]/comments.ts')
const removal   = await import('./[bundleId]/comments/[commentId].ts')
const bundleApi = await import('./[bundleId].ts')
const listApi   = await import('./index.ts')
const { listEvents } = await import('~/_lib/bundle-events.ts')

const B   = 'bundle:package-archive-example:2026-10-08T07:00:00.000Z'
const key = (rest: string) => `proposals/bundles/${B}/${rest}`

function setup() {
  const bucket = memoryR2({
    [key('manifest.json')]: { bundleId: B, summary: 'Test', createdAt: '2026-10-08T07:00:00.000Z', model: 'none', promptHash: 'none', origin: { type: 'package', site: 'https://archive.example', madeAt: 'x' }, entities: [{ entityId: 'Unit:a', status: 'pending', opSummary: ['create'] }, { entityId: 'Unit:b', status: 'pending', opSummary: ['create'] }] },
  })
  return { bucket, env: { PROPOSALS: bucket, SESSION_SECRET: 's' } }
}
const post = (body: unknown) => ({ request: new Request('https://site.example/x', { method: 'POST', body: JSON.stringify(body) }) })
const get  = (qs: string) => ({ request: new Request(`https://site.example/x?${qs}`) })
const call = (fn: unknown, env: unknown, { request }: { request: Request }, extra: Record<string, string> = {}) =>
  (fn as (c: never) => Promise<Response>)({ request, env, params: { bundleId: B, ...extra } } as never)

// Things done one after the other happen at different times; the order of the lists is the order of the clock.
let clock = Date.parse('2026-10-08T08:00:00.000Z')
const tick = () => { clock += 1000; vi.setSystemTime(clock) }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(clock)
  vi.mocked(requireAdmin).mockResolvedValue(ROLF)
})

describe('adding a comment (#186)', () => {
  it('writes one object, with its scope in the metadata, and a pointer in the log (no text)', async () => {
    const { bucket, env } = setup()
    const res = await call(comments.onRequestPost, env, post({ type: 'entity', entityId: 'Unit:a', text: 'Kildene må sjekkes.' }))
    expect(res.status).toBe(201)
    const { comment } = await res.json<{ comment: { id: string; actor: unknown } }>()
    expect(comment.actor).toEqual({ id: 'u-rolf', name: 'Rolf' })
    const keys = bucket.keys(key('comments/'))
    expect(keys).toEqual([key(`comments/${comment.id}.json`)])
    expect(bucket.meta(keys[0])).toEqual({ type: 'entity', entityId: 'Unit:a' })
    const events = await listEvents(bucket as never, B)
    expect(events).toMatchObject([{ kind: 'commented', commentId: comment.id, scope: 'entity', entityId: 'Unit:a', actor: { name: 'Rolf' } }])
    expect(JSON.stringify(events)).not.toContain('Kildene')
  })

  it('refuses what is not a comment of this bundle, and writes nothing', async () => {
    const { bucket, env } = setup()
    for (const body of [{ type: 'entity', text: 'x' }, { type: 'entity', entityId: 'Unit:zzz', text: 'x' }, { type: 'bundle', entityId: 'Unit:a', text: 'x' }, { type: 'bundle', text: ' ' }, { type: 'op', text: 'x' }]) {
      expect((await call(comments.onRequestPost, env, post(body))).status).toBe(400)
    }
    expect(bucket.keys(key('comments/'))).toEqual([])
    expect(bucket.keys(key('events/'))).toEqual([])
  })

  it('answers 404 for a bundle that is not there, and 403 for someone who is not an admin', async () => {
    const { env } = setup()
    const gone = { request: new Request('https://site.example/x', { method: 'POST', body: JSON.stringify({ type: 'bundle', text: 'x' }) }) }
    expect((await (comments.onRequestPost as unknown as (c: never) => Promise<Response>)({ request: gone.request, env, params: { bundleId: 'bundle:other:2026-10-08T07:00:00.000Z' } } as never)).status).toBe(404)
    vi.mocked(requireAdmin).mockResolvedValueOnce(new Response('no', { status: 403 }))
    expect((await call(comments.onRequestPost, env, post({ type: 'bundle', text: 'x' }))).status).toBe(403)
  })

  it('two editors at once: two comments, none lost', async () => {
    const { bucket, env } = setup()
    vi.mocked(requireAdmin).mockResolvedValueOnce(ROLF).mockResolvedValueOnce({ ...ROLF, id: 'u-jan', name: 'Jan' })
    await Promise.all([
      call(comments.onRequestPost, env, post({ type: 'bundle', text: 'Rolf tar Personene.' })),
      call(comments.onRequestPost, env, post({ type: 'bundle', text: 'Jan tar Enhetene.' })),
    ])
    expect(bucket.keys(key('comments/'))).toHaveLength(2)
    const { comments: thread } = await (await call(comments.onRequestGet, env, get('type=bundle'))).json<{ comments: { text: string }[] }>()
    expect(thread.map(c => c.text).sort()).toEqual(['Jan tar Enhetene.', 'Rolf tar Personene.'])
  })
})

describe('reading the threads', () => {
  async function filled() {
    const s = setup()
    for (const body of [
      { type: 'bundle', text: 'Testbundle.' },
      { type: 'entity', entityId: 'Unit:a', text: 'Om a.' },
      { type: 'entity', entityId: 'Unit:a', text: 'Mer om a.' },
      { type: 'entity', entityId: 'Unit:b', text: 'Om b.' },
    ]) { tick(); await call(comments.onRequestPost, s.env, post(body)) }
    return s
  }

  it('keeps the bundle thread and each entity thread apart', async () => {
    const { env } = await filled()
    const thread = async (qs: string) => (await (await call(comments.onRequestGet, env, get(qs))).json<{ comments: { text: string }[] }>()).comments.map(c => c.text)
    expect(await thread('type=bundle')).toEqual(['Testbundle.'])
    expect(await thread('type=entity&entityId=Unit:a')).toEqual(['Om a.', 'Mer om a.'])
    expect(await thread('type=entity&entityId=Unit:b')).toEqual(['Om b.'])
    expect(await thread('type=entity&entityId=Unit:zzz')).toEqual([])
  })

  it('gives every count with the bundle, from the listing alone: no comment is read', async () => {
    const { env, bucket } = await filled()
    const reads: string[] = []
    const get0 = bucket.get
    bucket.get = (k: string) => { reads.push(k); return get0(k) }
    const body = await (await call(bundleApi.onRequestGet, env, get(''))).json<{ commentCounts: unknown }>()
    expect(body.commentCounts).toEqual({ bundle: 1, entities: { 'Unit:a': 2, 'Unit:b': 1 } })
    expect(reads.some(k => k.includes('/comments/'))).toBe(false)
  })

  it('counts the comments of each bundle in the list', async () => {
    const { env } = await filled()
    const { bundles } = await (await (listApi.onRequestGet as unknown as (c: never) => Promise<Response>)({ request: new Request('https://site.example/x'), env } as never)).json<{ bundles: { bundleId: string; comments: number }[] }>()
    expect(bundles).toMatchObject([{ bundleId: B, comments: 4 }])
  })

  it('shows the name a user has now', async () => {
    const { env } = await filled()
    const d1 = { prepare: () => ({ bind: () => ({ all: () => Promise.resolve({ results: [{ id: 'u-rolf', name: 'Rolf Halvorsen' }] }) }) }) }
    const res = await call(comments.onRequestGet, { ...env, milorg_users: d1 }, get('type=bundle'))
    expect((await res.json<{ comments: { actor: { name: string } }[] }>()).comments[0].actor.name).toBe('Rolf Halvorsen')
  })
})

describe('removing a comment', () => {
  it('deletes it, and the log says that one was removed, not what it said', async () => {
    const { bucket, env } = setup()
    const { comment } = await (await call(comments.onRequestPost, env, post({ type: 'bundle', text: 'Hemmelig tekst.' }))).json<{ comment: { id: string } }>()
    tick()
    const res = await call(removal.onRequestDelete, env, { request: new Request('https://site.example/x', { method: 'DELETE' }) }, { commentId: comment.id })
    expect(res.status).toBe(200)
    expect(bucket.keys(key('comments/'))).toEqual([])
    const events = await listEvents(bucket as never, B)
    expect(events.map(e => e.kind)).toEqual(['commented', 'comment-removed'])
    expect(JSON.stringify(events)).not.toContain('Hemmelig')
  })

  it('answers 404 for a comment that is gone, and refuses an id that is a path', async () => {
    const { env } = setup()
    const del = { request: new Request('https://site.example/x', { method: 'DELETE' }) }
    expect((await call(removal.onRequestDelete, env, del, { commentId: '2026-10-08T07:30:00.870Z-02cc' })).status).toBe(404)
    expect((await call(removal.onRequestDelete, env, del, { commentId: '../manifest' })).status).toBe(400)
  })

  it('goes into the archive with the bundle when it is deleted', async () => {
    const { bucket, env } = setup()
    await call(comments.onRequestPost, env, post({ type: 'bundle', text: 'x' }))
    await call(bundleApi.onRequestDelete, env, { request: new Request('https://site.example/x', { method: 'DELETE', body: JSON.stringify({ reason: 'Testbundle' }) }) })
    expect(bucket.keys(key(''))).toEqual([])
    const archive = bucket.json(`proposals/archive/${B}.json`) as { objects: Record<string, { value: { text?: string }; customMetadata?: Record<string, string> }> }
    const kept = Object.entries(archive.objects).filter(([k]) => k.startsWith('comments/'))
    // the one written here, and the reason for archiving, which is a comment too
    expect(kept.map(([, o]) => o.value.text).sort()).toEqual(['Arkivert: Testbundle', 'x'])
    expect(kept[0][1]).toMatchObject({ customMetadata: { type: 'bundle' } })
  })
})
