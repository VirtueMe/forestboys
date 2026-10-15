import { beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryR2 } from '~/_lib/memory-r2.ts'

vi.mock('~/_lib/require-admin.ts', () => ({ requireAdmin: vi.fn(() => Promise.resolve({ id: 'u', name: 'Rolf', role: 'admin' })) }))
const { requireAdmin } = await import('~/_lib/require-admin.ts')
const { onRequestPost } = await import('./entity-records.ts')

const B = 'bundle:ancc:2026-10-01T07:00:00.000Z'
const bucket = () => memoryR2({
  [`proposals/bundles/${B}/manifest.json`]: { bundleId: B, entities: [{ entityId: 'Person:ola', status: 'pending', opSummary: [] }] },
  [`proposals/bundles/${B}/entity/Person:ola.json`]: { ops: [{ op: 'set-props', props: { rank: {} } }] },
  'proposals/by-entity/Person:ola/index.json': { bundleIds: [B] },
})
const post = (b: ReturnType<typeof bucket>, body?: unknown) =>
  onRequestPost({ request: new Request('https://site.example/x', { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env: { PROPOSALS: b, SESSION_SECRET: 's' } } as never)

beforeEach(() => vi.mocked(requireAdmin).mockClear())

describe('POST /api/admin/proposals/entity-records (#273)', () => {
  it('is a dry run without a body, and says what it would write', async () => {
    const b = bucket()
    const res = await post(b)
    expect(await res.json()).toMatchObject({ ok: true, write: false, changed: 1, next: null })
    expect(b.keys('proposals/by-entity/Person:ola/')).toEqual(['proposals/by-entity/Person:ola/index.json'])
  })

  it('writes with write: true, and drops the old indexes only when asked', async () => {
    const b = bucket()
    expect(await (await post(b, { write: true })).json()).toMatchObject({ write: true, changed: 1 })
    expect(b.meta(`proposals/by-entity/Person:ola/${B}.json`)).toMatchObject({ status: 'pending', props: 'rank' })
    expect(b.keys('proposals/by-entity/Person:ola/')).toHaveLength(2)
    expect(await (await post(b, { dropIndexes: true, write: true })).json()).toMatchObject({ found: 1, deleted: 1 })
    expect(b.keys('proposals/by-entity/Person:ola/')).toEqual([`proposals/by-entity/Person:ola/${B}.json`])
  })

  it('refuses someone who is not an admin', async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(new Response('no', { status: 403 }))
    const b = bucket()
    expect((await post(b, { write: true })).status).toBe(403)
    expect(b.keys('proposals/by-entity/Person:ola/')).toEqual(['proposals/by-entity/Person:ola/index.json'])
  })
})
