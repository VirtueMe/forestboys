import { beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryR2 } from '~/_lib/memory-r2.ts'
import { recordKey, recordOf, toMetadata, type EntityRecordStatus, type OpLike } from '../../../../../src/utils/entityRecord.ts'

vi.mock('~/_lib/require-admin.ts', () => ({ requireAdmin: vi.fn(() => Promise.resolve({ id: 'u', name: 'Rolf', role: 'admin' })) }))
const { onRequestGet } = await import('./proposals.ts')

const E  = 'Person:ola'
const B1 = 'bundle:ancc:2026-10-01T07:00:00.000Z'
const B2 = 'bundle:sanity-person:2026-10-02T07:00:00.000Z'
const B3 = 'bundle:ancc:2026-10-03T07:00:00.000Z'

const setProps = (...names: string[]): OpLike[] => [{ op: 'set-props', props: Object.fromEntries(names.map(n => [n, {}])) }]

function setup(bundles: [string, EntityRecordStatus, OpLike[]][]) {
  const files: Record<string, unknown> = {}
  for (const [id, status] of bundles) {
    files[`proposals/bundles/${id}/manifest.json`] = {
      bundleId: id, summary: `Forslag ${id}`, createdAt: id.split(':').slice(2).join(':'), model: 'none', promptHash: 'none',
      origin: { type: 'package', site: 'https://archive.example', madeAt: 'x' },
      entities: [{ entityId: E, status: status === 'archived' ? 'pending' : status, opSummary: ['x'] }],
    }
  }
  const bucket = memoryR2(files)
  for (const [id, status, ops] of bundles) void bucket.put(recordKey(E, id), '{}', { customMetadata: toMetadata(recordOf(id, E, status, ops)) })
  return bucket
}

const get = (bucket: ReturnType<typeof memoryR2>, query = '') =>
  onRequestGet({ request: new Request(`https://site.example/api/admin/Person/ola/proposals${query}`), env: { PROPOSALS: bucket, SESSION_SECRET: 's' }, params: { kind: 'Person', slug: 'ola' } } as never)

beforeEach(() => vi.clearAllMocks())

describe('GET /api/admin/<kind>/<slug>/proposals (#273)', () => {
  it('counts the pending records and nothing else, without reading a body', async () => {
    const bucket = setup([[B1, 'accepted', setProps('rank')], [B2, 'pending', setProps('rank')], [B3, 'pending', setProps('born')]])
    const spy = vi.spyOn(bucket, 'get')
    const res = await get(bucket, '?count=true')
    expect(await res.json()).toMatchObject({ pendingCount: 2 })
    expect(spy).not.toHaveBeenCalled()
  })

  it('has no pending bundles and no others for an entity nobody proposed anything for', async () => {
    const res = await get(memoryR2())
    expect(await res.json()).toMatchObject({ openBundles: [], otherBundles: [] })
    expect(await (await get(memoryR2(), '?count=true')).json()).toMatchObject({ pendingCount: 0 })
  })

  it('returns the pending bundles open, and every other bundle in any state with what it changes', async () => {
    const bucket = setup([[B1, 'accepted', setProps('rank')], [B2, 'denied', setProps('born')], [B3, 'pending', setProps('died')]])
    const body = await (await get(bucket)).json<{ openBundles: { bundleId: string; conflictsWith: unknown[] }[]; otherBundles: Record<string, unknown>[] }>()
    expect(body.openBundles.map(b => b.bundleId)).toEqual([B3])
    expect(body.openBundles[0].conflictsWith).toEqual([])
    expect(body.otherBundles).toMatchObject([
      { bundleId: B2, status: 'denied',   createdAt: '2026-10-02T07:00:00.000Z', props: ['born'] },
      { bundleId: B1, status: 'accepted', createdAt: '2026-10-01T07:00:00.000Z', props: ['rank'] },
    ])
  })

  it('marks two pending bundles that change the same property on both, and says which', async () => {
    const bucket = setup([[B1, 'pending', setProps('rank', 'born')], [B3, 'pending', setProps('rank')], [B2, 'pending', setProps('died')]])
    const body = await (await get(bucket)).json<{ openBundles: { bundleId: string; conflictsWith: { bundleId: string; shared: string[] }[] }[] }>()
    const by = Object.fromEntries(body.openBundles.map(b => [b.bundleId, b.conflictsWith]))
    expect(by[B1]).toEqual([{ bundleId: B3, shared: ['rank'] }])
    expect(by[B3]).toEqual([{ bundleId: B1, shared: ['rank'] }])
    expect(by[B2]).toEqual([])
  })

  it('does not call a decided bundle a conflict, and leaves an archived one among the others', async () => {
    const bucket = setup([[B1, 'accepted', setProps('rank')], [B2, 'archived', setProps('rank')], [B3, 'pending', setProps('rank')]])
    const body = await (await get(bucket)).json<{ openBundles: { conflictsWith: unknown[] }[]; otherBundles: { status: string }[] }>()
    expect(body.openBundles[0].conflictsWith).toEqual([])
    expect(body.otherBundles.map(o => o.status)).toEqual(['archived', 'accepted'])
  })

  it('ignores the old shared index.json while it is still there', async () => {
    const bucket = setup([[B3, 'pending', setProps('rank')]])
    await bucket.put(`proposals/by-entity/${E}/index.json`, JSON.stringify({ bundleIds: [B1] }))
    const body = await (await get(bucket)).json<{ openBundles: unknown[]; otherBundles: unknown[] }>()
    expect(body.openBundles).toHaveLength(1)
    expect(body.otherBundles).toEqual([])
  })
})
