import { beforeEach, describe, expect, it, vi } from 'vitest'

const ROLF = { id: 'u-rolf', email: 'rolf@example.org', name: 'Rolf', role: 'admin' }
vi.mock('~/_lib/require-admin.ts', () => ({ requireAdmin: vi.fn(() => Promise.resolve(ROLF)) }))

const { requireAdmin } = await import('~/_lib/require-admin.ts')
const site = await import('./site.ts')

/** D1 stand-in: remembers what is written and answers reads from it. */
function fakeDb() {
  const rows = new Map<string, string>()
  return {
    rows,
    prepare() {
      let args: unknown[] = []
      const stmt = {
        bind(...a: unknown[]) { args = a; return stmt },
        all: () => Promise.resolve({ results: [...rows].filter(([k]) => args.includes(k)).map(([key, value]) => ({ key, value })) }),
        run: () => { rows.set(args[0] as string, args[1] as string) },
      }
      return stmt
    },
    batch(stmts: { run(): unknown }[]) { for (const s of stmts) s.run(); return Promise.resolve([]) },
  } as unknown as D1Database & { rows: Map<string, string> }
}

const call = (fn: unknown, db: D1Database, init?: RequestInit) =>
  (fn as (c: never) => Promise<Response>)({
    request: new Request('https://site.example/api/admin/site-settings/site', init),
    env: { SESSION_SECRET: 's', milorg_users: db },
  } as never)
const put = (body: unknown) => ({ method: 'PUT', body: JSON.stringify(body) })

beforeEach(() => { vi.mocked(requireAdmin).mockResolvedValue(ROLF) })

describe('/api/admin/site-settings/site', () => {
  it('refuses a non-admin on GET and PUT, and writes nothing', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(new Response('{}', { status: 403 }))
    const db = fakeDb()
    expect((await call(site.onRequestGet, db)).status).toBe(403)
    expect((await call(site.onRequestPut, db, put({ name: 'A', shortName: 'B' }))).status).toBe(403)
    expect(db.rows.size).toBe(0)
  })

  it('answers with the defaults until something is saved', async () => {
    const res = await call(site.onRequestGet, fakeDb())
    expect(await res.json()).toEqual({ name: 'Milorg 2 Utforsker', shortName: 'Milorg 2' })
  })

  it('saves trimmed names and reads them back', async () => {
    const db = fakeDb()
    const saved = await call(site.onRequestPut, db, put({ name: ' Motstandsbevegelsen ', shortName: 'MB' }))
    expect(saved.status).toBe(200)
    expect(await saved.json()).toEqual({ name: 'Motstandsbevegelsen', shortName: 'MB' })
    expect(await (await call(site.onRequestGet, db)).json()).toEqual({ name: 'Motstandsbevegelsen', shortName: 'MB' })
  })

  it('refuses empty or too long names with 400 and keeps what was saved', async () => {
    const db = fakeDb()
    await call(site.onRequestPut, db, put({ name: 'Før', shortName: 'F' }))
    for (const body of [{ name: '', shortName: 'B' }, { name: 'A', shortName: 'x'.repeat(25) }, { name: 'A' }]) {
      expect((await call(site.onRequestPut, db, put(body))).status).toBe(400)
    }
    expect(db.rows.get('site.name')).toBe('Før')
  })
})
