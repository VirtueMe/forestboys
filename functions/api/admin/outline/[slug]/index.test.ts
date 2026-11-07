import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/_lib/require-admin.ts', () => ({ requireAdmin: vi.fn(() => Promise.resolve({ id: 1, name: 'A', role: 'admin' })) }))
vi.mock('~/_lib/neo4j.ts', () => ({ runCypher: vi.fn() }))
vi.mock('~/_lib/sitemap.ts', () => ({ invalidateSitemap: vi.fn(() => Promise.resolve()) }))
vi.mock('~/_lib/slug-alias.ts', async (orig) => ({ ...(await orig<typeof import('~/_lib/slug-alias.ts')>()), slugClaim: vi.fn() }))

const { runCypher } = await import('~/_lib/neo4j.ts')
const { slugClaim } = await import('~/_lib/slug-alias.ts')
const { requireAdmin } = await import('~/_lib/require-admin.ts')
const { onRequestPost } = await import('./index.ts')

const call = (body: unknown, slug = 'new') => (onRequestPost as unknown as (c: unknown) => Promise<Response>)({
  request: new Request('https://x.test', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }),
  env: {}, params: { slug }, waitUntil: () => {},
})

beforeEach(() => {
  vi.mocked(runCypher).mockReset().mockResolvedValue([] as never)
  vi.mocked(slugClaim).mockReset().mockResolvedValue(null)
})

describe('POST /api/admin/outline/new', () => {
  it('creates a node with a slug and a name and nothing from Sanity', async () => {
    const res = await call({ slug: 'my-report', canonicalName: '  My report ' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, slug: 'my-report' })
    expect(slugClaim).toHaveBeenCalledWith({}, '/outlines/', 'my-report')
    const [, cypher, params] = vi.mocked(runCypher).mock.calls[0]
    expect(cypher).toContain('CREATE (o:Outline')
    expect(cypher).not.toMatch(/sanity/i)
    expect(params).toEqual({ slug: 'my-report', name: 'My report' })
  })

  it('refuses a slug that is taken, live or an old name, with a 409 and writes nothing', async () => {
    vi.mocked(slugClaim).mockResolvedValue('live')
    expect((await call({ slug: 'taken', canonicalName: 'T' })).status).toBe(409)
    vi.mocked(slugClaim).mockResolvedValue('alias')
    expect((await call({ slug: 'old', canonicalName: 'T' })).status).toBe(409)
    expect(runCypher).not.toHaveBeenCalled()
  })

  it('refuses a bad request: another URL slug, bad JSON, no name, a bad or reserved slug', async () => {
    expect((await call({ slug: 'a', canonicalName: 'A' }, 'some-outline')).status).toBe(400)
    expect((await call('{')).status).toBe(400)
    expect((await call({ slug: 'a', canonicalName: '   ' })).status).toBe(400)
    expect((await call({ slug: 'Has Space', canonicalName: 'A' })).status).toBe(400)
    expect((await call({ slug: 'new', canonicalName: 'A' })).status).toBe(400)
    expect(runCypher).not.toHaveBeenCalled()
  })

  it('stops at the admin check', async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(new Response('no', { status: 403 }))
    expect((await call({ slug: 'a', canonicalName: 'A' })).status).toBe(403)
    expect(runCypher).not.toHaveBeenCalled()
  })
})
