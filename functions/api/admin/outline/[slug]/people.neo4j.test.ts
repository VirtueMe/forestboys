/**
 * PATCH /api/admin/outline/:slug/people against the local Neo4j (#389): the endpoint's real Cypher, only the admin check
 * is stood in for. Opt in with `npm run test:neo4j`. Like the other neo4j tests it refuses anything but localhost and
 * touches only nodes whose slug or id starts with `zz-test-`; everything it made is removed afterwards.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'

vi.mock('~/_lib/require-admin.ts', () => ({ requireAdmin: vi.fn(() => Promise.resolve({ id: 'u', role: 'admin' })) }))
const people = await import('./people.ts')

const E = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env
const ENABLED = E.NEO4J_TEST === '1'

const env = {
  NEO4J_URI: E.NEO4J_URI ?? '', NEO4J_HTTP_URI: E.NEO4J_HTTP_URI,
  NEO4J_USERNAME: E.NEO4J_USERNAME ?? '', NEO4J_PASSWORD: E.NEO4J_PASSWORD ?? '',
} as Neo4jEnv

const RUN = Math.random().toString(36).slice(2, 8)
const P = `zz-test-${RUN}-`
const OUTLINE = `${P}outline`

const patch = (body: unknown, slug = OUTLINE) =>
  (people.onRequestPatch as unknown as (c: never) => Promise<Response>)({
    request: new Request('https://x.example/', { method: 'PATCH', body: JSON.stringify(body) }),
    env: { SESSION_SECRET: 's', ...env },
    params: { slug },
  } as never)

/** The outline's mentions: person slug (prefix cut) → the edge's properties. */
async function mentions(): Promise<Record<string, Record<string, unknown>>> {
  const rows = await runCypher<{ slug: string; r: Record<string, unknown> }>(env,
    `MATCH (:Outline {slug: $o})-[r:MENTIONS]->(p:Person) RETURN p.slug AS slug, r`, { o: OUTLINE })
  return Object.fromEntries(rows.map(r => [r.slug.slice(P.length), r.r]))
}

async function cleanup() {
  await runCypher(env, `MATCH (n) WHERE n.slug STARTS WITH 'zz-test-' OR n.id STARTS WITH 'zz-test-' DETACH DELETE n`, {})
}

describe.skipIf(!ENABLED)('outline people, against the local Neo4j', () => {
  beforeAll(async () => {
    const host = env.NEO4J_URI.replace(/^[a-z0-9+.-]+:\/\//, '').replace(/[:/].*$/, '')
    if (!/^(localhost|127\.0\.0\.1|::1)$/.test(host)) throw new Error(`NEO4J_URI points at ${host}: this test only runs against localhost`)
    await cleanup()
    await runCypher(env, `
      CREATE (o:Outline {slug: $o, canonicalName: 'Medlemmer'})-[:HAS_CONTENT]->(:Description {id: $d, order: 1, content: '[]'})
      CREATE (a:Person {slug: $p + 'a', canonicalName: 'Aa'}), (b:Person {slug: $p + 'b', canonicalName: 'Bb'}),
             (c:Person {slug: $p + 'c', canonicalName: 'Cc'}), (x:Person {slug: $p + 'x', canonicalName: 'Xx'})
      // a: from the Sanity sync (no props); b: carries import provenance; x: not in any list
      CREATE (o)-[:MENTIONS]->(a), (o)-[:MENTIONS {state: 'imported', sourceRef: 'sanity'}]->(b)
      CREATE (x)-[:REFERENCED_IN]->(:Source {id: $p + 'src', title: 'Kilde'})`,
      { o: OUTLINE, p: P, d: `${P}desc` })
  })
  afterAll(cleanup)

  it('adds a person, keeps the others and their edge props, and marks the new edge as an admin edit', async () => {
    const res = await patch({ people: [`${P}a`, `${P}b`, `${P}c`] })
    expect(await res.json()).toEqual({ ok: true, count: 3 })
    const m = await mentions()
    expect(Object.keys(m).sort()).toEqual(['a', 'b', 'c'])
    expect(m.b).toMatchObject({ state: 'imported', sourceRef: 'sanity' })
    expect(m.c).toMatchObject({ state: 'verified', sourceRef: 'admin-edit' })
  })

  it('removes a person left out of the list, and only that edge', async () => {
    const res = await patch({ people: [`${P}a`, `${P}c`] })
    expect(res.status).toBe(200)
    expect(Object.keys(await mentions()).sort()).toEqual(['a', 'c'])
    // the person and the rest of the graph are untouched
    const rows = await runCypher<{ n: number }>(env, `
      MATCH (b:Person {slug: $b}) MATCH (x:Person {slug: $x})-[:REFERENCED_IN]->(:Source)
      MATCH (:Outline {slug: $o})-[:HAS_CONTENT]->(:Description)
      RETURN count(*) AS n`, { b: `${P}b`, x: `${P}x`, o: OUTLINE })
    expect(Number(rows[0].n)).toBe(1)
  })

  it('names an unknown person and changes nothing', async () => {
    const res = await patch({ people: [`${P}a`, `${P}ghost`] })
    expect(res.status).toBe(400)
    expect((await res.json<{ error: string }>()).error).toContain(`${P}ghost`)
    expect(Object.keys(await mentions()).sort()).toEqual(['a', 'c'])
  })

  it('is a 404 for an outline that does not exist', async () => {
    expect((await patch({ people: [`${P}a`] }, `${P}nothing`)).status).toBe(404)
  })

  it('an empty list removes every mention, and a second save of the same list changes nothing', async () => {
    expect((await patch({ people: [] })).status).toBe(200)
    expect(await mentions()).toEqual({})
    await patch({ people: [`${P}a`] })
    const before = await mentions()
    await patch({ people: [`${P}a`] })
    expect(await mentions()).toEqual(before)
  })
})
