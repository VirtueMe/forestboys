/**
 * The transport sync's gallery write against the local Neo4j (#420): Sanity's images added in its order, an editor's
 * image and edge settings left alone, and a second run that changes nothing. Opt in with `npm run test:neo4j`.
 *
 * Safe by construction: localhost only, every node has a slug or id starting `zz-test-<run>-`, and everything made is
 * removed afterwards, and what a crashed run left is removed first.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import neo4j from 'neo4j-driver'
import { neo4jDriver } from './person-sync.ts'
import { GALLERY_QUERY, GRAPH_QUERY } from './transport-sync.ts'

const ENABLED = process.env.NEO4J_TEST === '1'
const RUN = Math.random().toString(36).slice(2, 8)
const P = `zz-test-${RUN}-`
const CDN = 'https://cdn.sanity.io/images/7r6kqtqy/production/'

const driver = ENABLED ? neo4jDriver() : (null as never)
async function run(cypher: string, params: Record<string, unknown> = {}) {
  const s = driver.session({ defaultAccessMode: neo4j.session.WRITE })
  try { return (await s.run(cypher, params)).records.map(r => r.toObject()) } finally { await s.close() }
}
const cleanup = () => run(`MATCH (n) WHERE n.slug STARTS WITH 'zz-test-' OR n.id STARTS WITH 'zz-test-' DETACH DELETE n`)
const num = (v: unknown) => (neo4j.isInt(v) ? v.toNumber() : v)
const edges = async () => (await run(`
  MATCH (:Transport {sanityId: $id})-[h:HAS_IMAGE]->(i:Source) RETURN i.id AS id, h.order AS order, h.isHero AS hero ORDER BY id`,
  { id: `${P}sid` })).map(r => [r.id, num(r.order), r.hero ?? null])

describe.skipIf(!ENABLED)('transport gallery write, against the local Neo4j', () => {
  beforeAll(async () => {
    const host = (process.env.NEO4J_URI ?? '').replace(/^[a-z0-9+.-]+:\/\//, '').replace(/[:/].*$/, '')
    if (!/^(localhost|127\.0\.0\.1|::1)$/.test(host)) throw new Error(`NEO4J_URI points at ${host}: this test only runs against localhost`)
    await cleanup()
    await run(`
      CREATE (n:Transport {slug: $p + 'tr', sanityId: $p + 'sid', canonicalName: 'Prøvefly'})
      CREATE (n)-[:HAS_IMAGE {order: 1, isHero: true}]->(:Source {id: $p + 'img-a', url: $cdn + 'a.png', type: 'photograph', sanityAssetRef: $p + 'a'})
      CREATE (n)-[:HAS_IMAGE {order: 2}]->(:Source {id: $p + 'own', url: 'https://example.org/own.jpg', type: 'photograph'})`,
    { p: P, cdn: CDN })
  })
  afterAll(async () => { await cleanup(); await driver.close() })

  const images = [
    { id: `${P}img-a`, url: `${CDN}a.png`, assetRef: `${P}a`, order: 1 },
    { id: `${P}img-b`, url: `${CDN}b.png`, assetRef: `${P}b`, order: 2 },
  ]
  const expected = [
    [`${P}img-a`, 1, true],   // kept, the editor's hero mark still on it
    [`${P}img-b`, 2, null],   // added from Sanity
    [`${P}own`, 2, null],     // the editor's own image, not from Sanity
  ]

  it('adds the missing image and leaves an editor\'s image and settings alone', async () => {
    const [{ n }] = await run(GALLERY_QUERY, { rows: [{ id: `${P}sid`, images }] })
    expect(num(n)).toBe(1)
    expect(await edges()).toEqual(expected)
  })

  it('changes nothing on a second run', async () => {
    await run(GALLERY_QUERY, { rows: [{ id: `${P}sid`, images }] })
    expect(await edges()).toEqual(expected)
    const [{ c }] = await run(`MATCH (s:Source) WHERE s.id STARTS WITH $p RETURN count(s) AS c`, { p: P })
    expect(num(c)).toBe(3)
  })

  it('reads the graph\'s Sanity images back in order, for the next comparison', async () => {
    const rows = await run(GRAPH_QUERY)
    const mine = rows.find(r => r.sanityId === `${P}sid`)
    expect(mine?.imageRefs).toEqual([`${P}a`, `${P}b`])
  })

  it('takes a Sanity image away that Sanity no longer has, and keeps the editor\'s own', async () => {
    await run(GALLERY_QUERY, { rows: [{ id: `${P}sid`, images: [] }] })
    expect((await edges()).map(r => r[0])).toEqual([`${P}own`])
  })
})
