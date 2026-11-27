/**
 * Event crew against a real Neo4j (the local one). Opt in with `npm run test:neo4j`. Refuses anything but localhost and
 * touches only nodes whose slug or key starts with `zz-test-`; the cleanup under test removes only stray assignments.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { runCypher, type Neo4jEnv } from './neo4j.ts'
import { replaceEventCrew } from './event-crew.ts'
import { DROP_STRAY_CREW } from './event-crew-cypher.ts'
import { saveEdgeSet } from './edge-set.ts'

const E = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env
const ENABLED = E.NEO4J_TEST === '1'

const env = {
  NEO4J_URI: E.NEO4J_URI ?? '', NEO4J_HTTP_URI: E.NEO4J_HTTP_URI,
  NEO4J_USERNAME: E.NEO4J_USERNAME ?? '', NEO4J_PASSWORD: E.NEO4J_PASSWORD ?? '',
} as Neo4jEnv

const P = `zz-test-${Math.random().toString(36).slice(2, 8)}-`
const op = `${P}op`, boat = `${P}boat`, plane = `${P}plane`, ola = `${P}ola`, kari = `${P}kari`, role = `${P}skipper`

async function cleanup() {
  await runCypher(env, `
    MATCH (a:CrewAssignment)-[:ON_EVENT]->(e) WHERE e.slug STARTS WITH $p DETACH DELETE a`, { p: P })
  await runCypher(env, `MATCH (n) WHERE n.slug STARTS WITH $p OR n.key STARTS WITH $p DETACH DELETE n`, { p: P })
}

const crew = (transport = boat) => runCypher<{ id: string; person: string; role: string | null }>(env, `
  MATCH (p:Person)-[:SERVED_AS]->(a:CrewAssignment)-[:ON_EVENT]->({slug: $op}), (a)-[:ABOARD]->({slug: $transport})
  RETURN a.id AS id, p.slug AS person, a.role AS role ORDER BY person
`, { op, transport })

const participants = () => runCypher<{ person: string }>(env,
  `MATCH (p:Person)-[:PARTICIPATED_IN]->({slug: $op}) RETURN p.slug AS person ORDER BY person`, { op })

const ids = (out: Awaited<ReturnType<typeof replaceEventCrew>>): string[] => {
  if ('error' in out) throw new Error(out.error)
  return out.ids
}

describe.skipIf(!ENABLED)('event crew, against the local Neo4j', () => {
  beforeAll(() => {
    const host = env.NEO4J_URI.replace(/^[a-z0-9+.-]+:\/\//, '').replace(/[:/].*$/, '')
    if (!/^(localhost|127\.0\.0\.1|::1)$/.test(host)) throw new Error(`NEO4J_URI points at ${host}: this test only runs against localhost`)
  })
  beforeEach(async () => {
    await cleanup()
    await runCypher(env, `
      CREATE (e:Operation {slug: $op}), (b:Transport {slug: $boat}), (f:Transport {slug: $plane}),
             (e)-[:USED]->(b), (e)-[:USED]->(f),
             (:Person {slug: $ola}), (:Person {slug: $kari}), (:Role {key: $role, scopes: ['crew']})
    `, { op, boat, plane, ola, kari, role })
  })
  afterAll(cleanup)

  it('assigns per transport and adds the person to the event once', async () => {
    ids(await replaceEventCrew(env, op, boat, [{ personSlug: ola, role }]))
    ids(await replaceEventCrew(env, op, plane, [{ personSlug: ola }]))
    expect((await crew()).map(c => [c.person, c.role])).toEqual([[ola, role]])
    expect((await crew(plane)).map(c => [c.person, c.role])).toEqual([[ola, null]])
    expect((await participants()).map(p => p.person)).toEqual([ola])
  })

  it('keeps ids on a re-save, and leaves a removed crew member in the event', async () => {
    const [a, b] = ids(await replaceEventCrew(env, op, boat, [{ personSlug: ola }, { personSlug: kari }]))
    expect(ids(await replaceEventCrew(env, op, boat, [{ id: a, personSlug: ola, role }]))).toEqual([a])
    expect(await crew()).toEqual([{ id: a, person: ola, role }])
    expect(b).not.toBe(a)
    expect((await participants()).map(p => p.person)).toEqual([kari, ola])
  })

  it('keeps the order the list was saved in', async () => {
    const order = () => runCypher<{ person: string }>(env, `
      MATCH (p:Person)-[:SERVED_AS]->(a:CrewAssignment)-[:ON_EVENT]->({slug: $op}) RETURN p.slug AS person ORDER BY a.order
    `, { op })
    const [a, b] = ids(await replaceEventCrew(env, op, boat, [{ personSlug: ola }, { personSlug: kari }]))
    expect((await order()).map(c => c.person)).toEqual([ola, kari])
    ids(await replaceEventCrew(env, op, boat, [{ id: b, personSlug: kari }, { id: a, personSlug: ola }]))
    expect((await order()).map(c => c.person)).toEqual([kari, ola])
  })

  it('rejects an unknown role, a doubled row and a transport the event did not use', async () => {
    expect(await replaceEventCrew(env, op, boat, [{ personSlug: ola, role: `${P}nope` }])).toMatchObject({ status: 400 })
    expect(await replaceEventCrew(env, op, boat, [{ personSlug: ola }, { personSlug: ola }])).toMatchObject({ status: 400 })
    expect(await replaceEventCrew(env, op, `${P}other`, [])).toMatchObject({ status: 404 })
    expect(await crew()).toEqual([])
  })

  it('drops the assignments of a person taken off the event, and of a transport taken off it', async () => {
    ids(await replaceEventCrew(env, op, boat, [{ personSlug: ola }, { personSlug: kari }]))
    ids(await replaceEventCrew(env, op, plane, [{ personSlug: ola }]))
    await saveEdgeSet(env, {
      anchor: { label: 'Operation', slug: op }, rel: 'PARTICIPATED_IN', direction: 'in', targetLabel: 'Person',
      items: [{ slug: ola }],
    })
    expect((await crew()).map(c => c.person)).toEqual([ola])

    await runCypher(env, `MATCH ({slug: $op})-[r:USED]->({slug: $plane}) DELETE r`, { op, plane })
    await runCypher(env, DROP_STRAY_CREW)
    expect(await crew(plane)).toEqual([])
    expect((await crew()).map(c => c.person)).toEqual([ola])
  })

  it('drops the assignments of a deleted person', async () => {
    ids(await replaceEventCrew(env, op, boat, [{ personSlug: ola }]))
    await runCypher(env, `MATCH (p:Person {slug: $ola}) DETACH DELETE p`, { ola })
    await runCypher(env, DROP_STRAY_CREW)
    const left = await runCypher<{ n: number }>(env, `MATCH (a:CrewAssignment)-[:ON_EVENT]->({slug: $op}) RETURN count(a) AS n`, { op })
    expect(Number(left[0].n)).toBe(0)
  })
})
