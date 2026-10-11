import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/_lib/require-admin.ts', () => ({ requireAdmin: vi.fn(() => Promise.resolve({ id: 1, name: 'A', role: 'admin' })) }))
vi.mock('~/_lib/neo4j.ts', () => ({ runCypher: vi.fn() }))
vi.mock('~/_lib/slug-rename.ts', () => ({ planRename: vi.fn() }))

const { runCypher } = await import('~/_lib/neo4j.ts')
const { planRename } = await import('~/_lib/slug-rename.ts')
const { requireAdmin } = await import('~/_lib/require-admin.ts')
const { onRequestPost } = await import('./rename-preview.ts')

const call = (body: unknown, slug = 'old') => (onRequestPost as unknown as (c: unknown) => Promise<Response>)({
  request: new Request('https://x.test', { method: 'POST', body: JSON.stringify(body) }), env: {}, params: { slug },
})

beforeEach(() => { vi.mocked(runCypher).mockReset(); vi.mocked(planRename).mockReset() })

describe('POST /api/admin/event/:slug/rename-preview', () => {
  it('adds up the links and counts the descriptions, and writes nothing', async () => {
    vi.mocked(runCypher).mockResolvedValue([{ label: 'Operation' }] as never)
    vi.mocked(planRename).mockResolvedValue({
      label: 'Operation', route: '/events/', from: 'old', to: 'new', restoresAlias: false, ownDescriptions: 1,
      rewrites: [{ eid: 'a', before: '', after: '', links: 3 }, { eid: 'b', before: '', after: '', links: 1 }],
    })
    const res = await call({ slug: 'new' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, from: 'old', to: 'new', descriptions: 2, links: 4, restoresAlias: false })
    expect(planRename).toHaveBeenCalledWith({}, { label: 'Operation', from: 'old', to: 'new' })
    expect(vi.mocked(runCypher).mock.calls.every(c => c[3] === 'Read')).toBe(true)
  })

  it('gives the status the rename would: 409 for a taken slug, 404 for an unknown event, 400 without a slug', async () => {
    vi.mocked(runCypher).mockResolvedValue([{ label: 'Incident' }] as never)
    vi.mocked(planRename).mockResolvedValue({ error: 'Slug finnes allerede: x', status: 409 })
    const taken = await call({ slug: 'x' })
    expect(taken.status).toBe(409)
    expect(await taken.json()).toEqual({ error: 'Slug finnes allerede: x' })

    vi.mocked(runCypher).mockResolvedValue([] as never)
    expect((await call({ slug: 'x' }, 'nobody')).status).toBe(404)
    expect((await call({})).status).toBe(400)
  })

  it('is for admins only', async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(new Response('no', { status: 401 }))
    expect((await call({ slug: 'new' })).status).toBe(401)
    expect(planRename).not.toHaveBeenCalled()
  })
})
