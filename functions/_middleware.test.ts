import { describe, expect, it, vi } from 'vitest'
import { onRequest } from './_middleware.ts'
import { clearSitemapCache, pageStatus } from './_lib/sitemap.ts'

const known = { paths: [], known: new Set(['/person/linge', '/person/kåre']), aliases: new Map<string, string>() }

describe('pageStatus', () => {
  it('is 200 for a known entity, with encoding, case, slash and child page', () => {
    expect(pageStatus('/person/linge', known)).toBe(200)
    expect(pageStatus('/Person/k%C3%A5re/', known)).toBe(200)
    expect(pageStatus('/person/linge/medlemmer', known)).toBe(200)
  })
  it('is 404 for an unknown entity', () => { expect(pageStatus('/person/nope', known)).toBe(404) })
  it('is 200 for what is not an entity page, and for the create form', () => {
    for (const p of ['/', '/people', '/api/neo4j/query', '/auth/me', '/admin/users', '/person/new']) expect(pageStatus(p, known)).toBe(200)
  })
  it('fails open without a list', () => { expect(pageStatus('/person/nope', null)).toBe(200) })
})

function run(path: string, method = 'GET', kv?: string) {
  clearSitemapCache()
  const next = vi.fn(() => Promise.resolve(new Response('next', { headers: { 'Content-Type': 'application/json' } })))
  const ASSETS = { fetch: vi.fn(() => Promise.resolve(new Response('<html></html>', { headers: { 'Content-Type': 'application/json' } }))) }
  const SITEMAP = kv === undefined ? undefined : { getWithMetadata: () => Promise.resolve({ value: kv, metadata: { builtAt: Date.now() } }) }
  const ctx = { request: new Request('https://x.test' + path, { method }), env: { ASSETS, SITEMAP }, next, waitUntil: () => {} }
  return { next, ASSETS, res: (onRequest as unknown as (c: unknown) => Promise<Response>)(ctx) }
}

describe('middleware', () => {
  it('passes everything but entity pages straight through', async () => {
    for (const [p, m] of [['/api/x', 'GET'], ['/person/linge', 'POST'], ['/person/a.js', 'GET'], ['/sitemap.txt', 'GET']]) {
      const { next, ASSETS, res } = run(p, m)
      expect((await res).status).toBe(200)
      expect(next).toHaveBeenCalledOnce()
      expect(ASSETS.fetch).not.toHaveBeenCalled()
    }
  })
  it('serves the shell with 200 for a known page and 404 for an unknown one', async () => {
    const list = '/person/linge\n/events/x'
    const hit = run('/person/linge/medlemmer', 'GET', list)
    expect((await hit.res).status).toBe(200)
    const miss = run('/person/nope', 'GET', list)
    const res = await miss.res
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('<html></html>')
    expect(miss.next).not.toHaveBeenCalled()
  })
  it('an old address of a renamed page is a 302 to the page, keeping the rest of the path and the query (#96)', async () => {
    const list = '/person/new-name\n/events/x\n/person/old-name\t/person/new-name\n/events/old-x\t/events/x'
    const moved = await run('/person/old-name/medlemmer?a=1', 'GET', list).res
    expect(moved.status).toBe(302)
    expect(moved.headers.get('Location')).toBe('https://x.test/person/new-name/medlemmer?a=1')
    const ev = await run('/events/Old-X', 'GET', list).res
    expect(ev.headers.get('Location')).toBe('https://x.test/events/x')
    // A page that exists is never redirected, whatever aliases say; an unknown slug with no alias is still a 404.
    expect((await run('/person/new-name', 'GET', list).res).status).toBe(200)
    expect((await run('/person/nobody', 'GET', list).res).status).toBe(404)
  })
  it('fails open: no KV binding means 200', async () => {
    expect((await run('/person/whatever').res).status).toBe(200)
  })
})
