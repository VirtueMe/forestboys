/**
 * Crew save against a real Neo4j (the local one). Opt in with `npm run test:neo4j`. Refuses anything but localhost and
 * touches only nodes whose slug or key starts with `zz-test-`; everything it made is removed afterwards.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { runCypher, type Neo4jEnv } from './neo4j.ts'
import { replaceCrew } from './crew.ts'

const E = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env
const ENABLED = E.NEO4J_TEST === '1'

const env = {
  NEO4J_URI: E.NEO4J_URI ?? '', NEO4J_HTTP_URI: E.NEO4J_HTTP_URI,
  NEO4J_USERNAME: E.NEO4J_USERNAME ?? '', NEO4J_PASSWORD: E.NEO4J_PASSWORD ?? '',
} as Neo4jEnv

const P = `zz-test-${Math.random().toString(36).slice(2, 8)}-`
const boat = `${P}boat`, ola = `${P}ola`, kari = `${P}kari`, role = `${P}skipper`

async function cleanup() {
  await runCypher(env, `MATCH (n) WHERE n.slug STARTS WITH $p OR n.key STARTS WITH $p DETACH DELETE n`, { p: P })
}

const edges = () => runCypher<{ id: string; person: string; role: string | null; from: string | null; to: string | null; state: string | null; sourceRef: string | null; extra: string | null }>(env, `
  MATCH (p:Person)-[r:CREW_OF]->(:Transport {slug: $boat})
  RETURN r.id AS id, p.slug AS person, r.role AS role, r.startDate AS from, r.endDate AS to,
         r.state AS state, r.sourceRef AS sourceRef, r.extra AS extra
  ORDER BY person, from
`, { boat })

const ids = (out: Awaited<ReturnType<typeof replaceCrew>>): string[] => {
  if ('error' in out) throw new Error(out.error)
  return out.ids
}

describe.skipIf(!ENABLED)('crew save, against the local Neo4j', () => {
  beforeAll(() => {
    const host = env.NEO4J_URI.replace(/^[a-z0-9+.-]+:\/\//, '').replace(/[:/].*$/, '')
    if (!/^(localhost|127\.0\.0\.1|::1)$/.test(host)) throw new Error(`NEO4J_URI points at ${host}: this test only runs against localhost`)
  })
  beforeEach(async () => {
    await cleanup()
    await runCypher(env, `
      CREATE (:Transport {slug: $boat}), (:Person {slug: $ola}), (:Person {slug: $kari}), (:Role {key: $role, scopes: ['crew']})
    `, { boat, ola, kari, role })
  })
  afterAll(cleanup)

  it('keeps two stints of one person, with their dates', async () => {
    ids(await replaceCrew(env, boat, [
      { personSlug: ola, role, startDate: '1942', endDate: '1943-05' },
      { personSlug: ola, startDate: '1944-01-02' },
    ]))
    expect((await edges()).map(e => [e.role, e.from, e.to, e.state])).toEqual([
      [role, '1942', '1943-05', 'verified'],
      [null, '1944-01-02', null, 'verified'],
    ])
  })

  it('updates a kept edge in place, adopts one without an id, and removes the rest', async () => {
    await runCypher(env, `
      MATCH (t:Transport {slug: $boat}), (o:Person {slug: $ola}), (k:Person {slug: $kari})
      CREATE (o)-[:CREW_OF {state: 'candidate', sourceRef: 'import', extra: 'kept'}]->(t), (k)-[:CREW_OF]->(t)
    `, { boat, ola, kari })
    const [{ key }] = await runCypher<{ key: string }>(env,
      `MATCH (:Person {slug: $ola})-[r:CREW_OF]->() RETURN elementId(r) AS key`, { ola })

    const [id] = ids(await replaceCrew(env, boat, [{ id: key, personSlug: ola }]))
    expect(await edges()).toEqual([{ id, person: ola, role: null, from: null, to: null, state: 'candidate', sourceRef: 'import', extra: 'kept' }])
    expect(id).not.toContain(':')

    expect(ids(await replaceCrew(env, boat, [{ id, personSlug: ola, startDate: '1943' }]))).toEqual([id])
    expect(await edges()).toMatchObject([{ id, from: '1943', state: 'verified', sourceRef: 'import', extra: 'kept' }])

    ids(await replaceCrew(env, boat, []))
    expect(await edges()).toEqual([])
  })

  it('rejects an unknown role, a bad period and an unknown person, and writes nothing', async () => {
    ids(await replaceCrew(env, boat, [{ personSlug: ola, role }]))
    for (const bad of [
      { personSlug: kari, role: `${P}admiral` },
      { personSlug: kari, startDate: '1944', endDate: '1943' },
      { personSlug: `${P}nobody` },
    ]) {
      expect(await replaceCrew(env, boat, [bad])).toMatchObject({ status: 400 })
    }
    expect(await edges()).toMatchObject([{ person: ola, role }])
  })
})
