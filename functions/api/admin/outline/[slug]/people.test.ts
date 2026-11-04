import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/_lib/require-admin.ts', () => ({ requireAdmin: vi.fn(() => Promise.resolve({ id: 'u', role: 'admin' })) }))
vi.mock('~/_lib/neo4j.ts', () => ({ runCypher: vi.fn() }))
vi.mock('~/_lib/edge-set.ts', () => ({ saveEdgeSet: vi.fn(() => Promise.resolve()) }))

const { requireAdmin } = await import('~/_lib/require-admin.ts')
const { runCypher } = await import('~/_lib/neo4j.ts')
const { saveEdgeSet } = await import('~/_lib/edge-set.ts')
const people = await import('./people.ts')

const call = (body: unknown, slug = 'linge-medlemmer') =>
  (people.onRequestPatch as unknown as (c: never) => Promise<Response>)({
    request: new Request('https://x.example/api/admin/outline/x/people', { method: 'PATCH', body: typeof body === 'string' ? body : JSON.stringify(body) }),
    env: { SESSION_SECRET: 's' },
    params: { slug },
  } as never)

/** What the check query answers: whether the outline exists, and which of the asked slugs are people. */
const graphHas = (found: boolean, known: string[]) => vi.mocked(runCypher).mockResolvedValue([{ found, known }])

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAdmin).mockResolvedValue({ id: 'u', role: 'admin' } as never)
})

describe('PATCH /api/admin/outline/:slug/people', () => {
  it('refuses a non-admin and touches nothing', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(new Response('{}', { status: 403 }))
    expect((await call({ people: ['a'] })).status).toBe(403)
    expect(runCypher).not.toHaveBeenCalled()
    expect(saveEdgeSet).not.toHaveBeenCalled()
  })

  it('refuses a body that is not a list of slugs', async () => {
    expect((await call('{nope')).status).toBe(400)
    expect((await call({})).status).toBe(400)
    expect((await call({ people: 'a' })).status).toBe(400)
    expect((await call({ people: ['a', ''] })).status).toBe(400)
    expect((await call({ people: [1] })).status).toBe(400)
    expect(saveEdgeSet).not.toHaveBeenCalled()
  })

  it('is a 404 for an outline that does not exist', async () => {
    graphHas(false, [])
    expect((await call({ people: ['a'] })).status).toBe(404)
    expect(saveEdgeSet).not.toHaveBeenCalled()
  })

  it('names the slugs that are no person, and saves nothing', async () => {
    graphHas(true, ['a'])
    const res = await call({ people: ['a', 'ghost'] })
    expect(res.status).toBe(400)
    expect((await res.json<{ error: string }>()).error).toContain('ghost')
    expect(saveEdgeSet).not.toHaveBeenCalled()
  })

  it('saves the list as MENTIONS out of the outline, one edge per person', async () => {
    graphHas(true, ['a', 'b'])
    const res = await call({ people: ['a', 'b', 'a'] })
    expect(await res.json()).toEqual({ ok: true, count: 2 })
    expect(saveEdgeSet).toHaveBeenCalledWith(expect.anything(), {
      anchor: { label: 'Outline', slug: 'linge-medlemmer' }, rel: 'MENTIONS', direction: 'out', targetLabel: 'Person',
      items: [{ slug: 'a' }, { slug: 'b' }],
    })
  })

  it('an empty list removes every mention', async () => {
    graphHas(true, [])
    expect(await (await call({ people: [] })).json()).toEqual({ ok: true, count: 0 })
    expect(vi.mocked(saveEdgeSet).mock.calls[0][1].items).toEqual([])
  })

  it('answers 502 when the graph fails', async () => {
    graphHas(true, ['a'])
    vi.mocked(saveEdgeSet).mockRejectedValueOnce(new Error('boom'))
    const res = await call({ people: ['a'] })
    expect(res.status).toBe(502)
    expect((await res.json<{ error: string }>()).error).toBe('boom')
  })
})
