/**
 * POST /api/admin/outline/new against the local Neo4j (#433): the endpoint's real Cypher and slug check, only the admin
 * check is stood in for. Opt in with `npm run test:neo4j`. Like the other neo4j tests it refuses anything but localhost
 * and touches only nodes whose slug starts with `zz-test-`; everything it made is removed afterwards.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'

vi.mock('~/_lib/require-admin.ts', () => ({ requireAdmin: vi.fn(() => Promise.resolve({ id: 'u', role: 'admin' })) }))
const outline = await import('./index.ts')

const E = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env
const ENABLED = E.NEO4J_TEST === '1'

const env = {
  NEO4J_URI: E.NEO4J_URI ?? '', NEO4J_HTTP_URI: E.NEO4J_HTTP_URI,
  NEO4J_USERNAME: E.NEO4J_USERNAME ?? '', NEO4J_PASSWORD: E.NEO4J_PASSWORD ?? '',
} as Neo4jEnv

const RUN = Math.random().toString(36).slice(2, 8)
const SLUG = `zz-test-${RUN}-outline`

const post = (body: unknown) =>
  (outline.onRequestPost as unknown as (c: never) => Promise<Response>)({
    request: new Request('https://x.example/', { method: 'POST', body: JSON.stringify(body) }),
    env: { SESSION_SECRET: 's', ...env },
    params: { slug: 'new' },
    waitUntil: () => {},
  } as never)

async function cleanup() {
  await runCypher(env, `MATCH (n) WHERE n.slug STARTS WITH 'zz-test-' DETACH DELETE n`, {})
}

describe.skipIf(!ENABLED)('create an outline, against the local Neo4j', () => {
  beforeAll(async () => {
    const host = env.NEO4J_URI.replace(/^[a-z0-9+.-]+:\/\//, '').replace(/[:/].*$/, '')
    if (!/^(localhost|127\.0\.0\.1|::1)$/.test(host)) throw new Error(`NEO4J_URI points at ${host}: this test only runs against localhost`)
    await cleanup()
  })
  afterAll(cleanup)

  it('makes the node with a slug and a name and no Sanity property', async () => {
    const res = await post({ slug: SLUG, canonicalName: 'En ny rapport' })
    expect(await res.json()).toEqual({ ok: true, slug: SLUG })
    const [row] = await runCypher<{ props: Record<string, unknown> }>(env, `MATCH (o:Outline {slug: $s}) RETURN properties(o) AS props`, { s: SLUG })
    expect(row.props).toEqual({ slug: SLUG, canonicalName: 'En ny rapport' })
  })

  it('refuses the same slug again, and keeps the first node as it was', async () => {
    const res = await post({ slug: SLUG, canonicalName: 'Noe annet' })
    expect(res.status).toBe(409)
    const rows = await runCypher<{ name: string }>(env, `MATCH (o:Outline {slug: $s}) RETURN o.canonicalName AS name`, { s: SLUG })
    expect(rows).toEqual([{ name: 'En ny rapport' }])
  })

  it('refuses an old slug of another outline', async () => {
    const old = `${SLUG}-old`
    await runCypher(env, `
      MATCH (o:Outline {slug: $s})
      CREATE (:SlugAlias {route: '/outlines/', slug: $old, kind: 'Outline'})-[:ALIAS_OF]->(o)`, { s: SLUG, old })
    expect((await post({ slug: old, canonicalName: 'X' })).status).toBe(409)
    await runCypher(env, `MATCH (a:SlugAlias {slug: $old}) DETACH DELETE a`, { old })
  })
})
