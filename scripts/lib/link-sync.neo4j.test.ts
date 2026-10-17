/**
 * The link sync's write against the local Neo4j (#118): the import's links made Sanity's, an editor's link left alone,
 * links only added for a `gap`, and a node with no links still counted. Opt in with `npm run test:neo4j`.
 *
 * Safe by construction: localhost only, every node has a slug or id starting `zz-test-<run>-`, and everything made is
 * removed afterwards, and what a crashed run left is removed first.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import neo4j from 'neo4j-driver'
import { neo4jDriver } from './person-sync.ts'
import { urlToId } from './person-rule.ts'
import { LINK_KINDS, applyQuery, graphQuery, sanityLinkSources, stampsFor } from './link-sync.ts'

const ENABLED = process.env.NEO4J_TEST === '1'
const RUN = Math.random().toString(36).slice(2, 8)
const P = `zz-test-${RUN}-`
const KIND = LINK_KINDS.station

const A = 'https://a.example/x', B = 'https://b.example/y', C = 'https://c.example/z', OWN = 'https://own.example/e'

const driver = ENABLED ? neo4jDriver() : (null as never)
async function run(cypher: string, params: Record<string, unknown> = {}) {
  const s = driver.session({ defaultAccessMode: neo4j.session.WRITE })
  try { return (await s.run(cypher, params)).records.map(r => r.toObject()) } finally { await s.close() }
}
// The Sources are the real ones (their id is the url's), so they are removed by url.
const cleanup = () => run(`
  MATCH (n) WHERE n.slug STARTS WITH 'zz-test-' OR n.id STARTS WITH 'zz-test-' OR (n:Source AND n.url IN $urls)
  DETACH DELETE n`, { urls: [A, B, C, OWN] })
const urls = async () => (await run(
  `MATCH (:Station {sanityId: $id})-[r:REFERENCED_IN]->(s:Source) RETURN s.url AS url, r.sourceRef AS ref ORDER BY url`, { id: `${P}sid` })).map(r => [r.url, r.ref ?? null])
const n = (v: unknown) => (neo4j.isInt(v) ? v.toNumber() : v)

const doc = (...links: string[]) => ({ _id: `${P}sid`, _updatedAt: '2026-10-04T00:00:00Z', links: links.map(link => ({ link })) })

describe.skipIf(!ENABLED)('link sync writes, against the local Neo4j', () => {
  beforeAll(async () => {
    const host = (process.env.NEO4J_URI ?? '').replace(/^[a-z0-9+.-]+:\/\//, '').replace(/[:/].*$/, '')
    if (!/^(localhost|127\.0\.0\.1|::1)$/.test(host)) throw new Error(`NEO4J_URI points at ${host}: this test only runs against localhost`)
    await cleanup()
    await run(`
      CREATE (n:Station {slug: $p + 'st', sanityId: $p + 'sid'})
      CREATE (n)-[:REFERENCED_IN]->(:Source {id: $ia, url: $a, type: 'website'})
      CREATE (n)-[:REFERENCED_IN]->(:Source {id: $ib, url: $b, type: 'website'})
      CREATE (n)-[:REFERENCED_IN {sourceRef: 'admin-edit'}]->(:Source {id: $p + 'own', url: $own, type: 'website'})`,
    { p: P, a: A, b: B, own: OWN, ia: urlToId(A), ib: urlToId(B) })
  })
  afterAll(async () => { await cleanup(); await driver.close() })

  it('reads the import\'s links and leaves out the editor\'s', async () => {
    const rows = await run(graphQuery(KIND))
    const mine = rows.find(r => r.sanityId === `${P}sid`)!
    expect([...mine.links as string[]].sort()).toEqual([A, B])
    expect(mine.stamp).toBeNull()
  })

  it('adds the missing links and removes none for a gap', async () => {
    const d = doc(A, C)
    const [{ n: count }] = await run(applyQuery(KIND), { rows: [{ id: d._id, links: sanityLinkSources(d), prune: false, stamps: stampsFor(d) }] })
    expect(n(count)).toBe(1)
    expect((await urls()).map(r => r[0])).toEqual([A, B, C, OWN])
  })

  it('makes the import\'s links Sanity\'s and keeps the editor\'s link, and stamps', async () => {
    const d = doc(A, C)
    await run(applyQuery(KIND), { rows: [{ id: d._id, links: sanityLinkSources(d), prune: true, stamps: stampsFor(d) }] })
    expect(await urls()).toEqual([[A, null], [C, null], [OWN, 'admin-edit']])
    const [{ stamp }] = await run(`MATCH (n:Station {sanityId: $id}) RETURN n.links_sha AS stamp`, { id: d._id })
    expect(stamp).toBe(stampsFor(d).links_sha)
  })

  it('still counts a node whose Sanity links are all gone', async () => {
    const d = doc()
    const [{ n: count }] = await run(applyQuery(KIND), { rows: [{ id: d._id, links: [], prune: true, stamps: stampsFor(d) }] })
    expect(n(count)).toBe(1)
    expect(await urls()).toEqual([[OWN, 'admin-edit']])
  })
})
