/**
 * The place sync's writes against the local Neo4j (#155): a gallery replaced without touching what an editor added, and a
 * rename in two phases with the old slug kept as an alias and the description id following. Opt in with
 * `npm run test:neo4j`.
 *
 * Safe by construction: localhost only, every node has a slug or id starting `zz-test-<run>-` (the description's id holds
 * it after `desc:location:`), and everything made is removed afterwards, and what a crashed run left is removed first.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import neo4j from 'neo4j-driver'
import { neo4jDriver } from './person-sync.ts'
import { LOCATION, galleryQuery, renamePhaseQuery } from './place-sync.ts'
import { renameAliases, dropShadowedAliases } from '../../functions/_lib/slug-alias-cypher.ts'

const ENABLED = process.env.NEO4J_TEST === '1'
const RUN = Math.random().toString(36).slice(2, 8)
const P = `zz-test-${RUN}-`
const CDN = 'https://cdn.sanity.io/images/7r6kqtqy/production/'

const driver = ENABLED ? neo4jDriver() : (null as never)
async function run(cypher: string, params: Record<string, unknown> = {}) {
  const s = driver.session({ defaultAccessMode: neo4j.session.WRITE })
  try { return (await s.run(cypher, params)).records.map(r => r.toObject()) } finally { await s.close() }
}
const cleanup = () => run(`
  MATCH (n) WHERE n.slug STARTS WITH 'zz-test-' OR n.id STARTS WITH 'zz-test-' OR n.id STARTS WITH 'desc:location:zz-test-'
  DETACH DELETE n`)

describe.skipIf(!ENABLED)('place sync writes, against the local Neo4j', () => {
  beforeAll(async () => {
    const host = (process.env.NEO4J_URI ?? '').replace(/^[a-z0-9+.-]+:\/\//, '').replace(/[:/].*$/, '')
    if (!/^(localhost|127\.0\.0\.1|::1)$/.test(host)) throw new Error(`NEO4J_URI points at ${host}: this test only runs against localhost`)
    await cleanup()
    await run(`
      CREATE (n:Location {slug: $p + 'old', sanityId: $p + 'sid', canonicalName: 'Prøvested'})
      CREATE (n)-[:HAS_CONTENT]->(:Description {id: 'desc:location:' + $p + 'old:1', order: 1, content: '[]'})
      CREATE (n)-[:HAS_IMAGE {order: 1}]->(:Source {id: $p + 'img-a', url: $cdn + 'a.png', type: 'photograph'})
      CREATE (n)-[:HAS_IMAGE {order: 2, isHero: true}]->(:Source {id: $p + 'img-b', url: $cdn + 'b.png', type: 'photograph'})
      CREATE (n)-[:HAS_IMAGE {order: 3}]->(:Source {id: $p + 'own', url: 'https://example.org/own.jpg', type: 'photograph'})`,
    { p: P, cdn: CDN })
  })
  afterAll(async () => { await cleanup(); await driver.close() })

  it('replaces the Sanity images by Sanity\'s gallery, in its order, and leaves an editor\'s image and settings alone', async () => {
    const images = [
      { id: `${P}img-b`, url: `${CDN}b.png`, assetRef: `${P}b`, order: 1 },
      { id: `${P}img-c`, url: `${CDN}c.png`, assetRef: `${P}c`, order: 2 },
    ]
    const [{ n }] = await run(galleryQuery(LOCATION), { rows: [{ id: `${P}sid`, images }] })
    expect(neo4j.isInt(n) ? n.toNumber() : n).toBe(1)
    const rows = await run(`
      MATCH (:Location {sanityId: $id})-[h:HAS_IMAGE]->(i:Source) RETURN i.id AS id, h.order AS order, h.isHero AS hero ORDER BY id`, { id: `${P}sid` })
    expect(rows.map(r => [r.id, neo4j.isInt(r.order) ? r.order.toNumber() : r.order, r.hero ?? null])).toEqual([
      [`${P}img-b`, 1, true],      // kept, reordered, the editor's hero mark still on it
      [`${P}img-c`, 2, null],      // new from Sanity
      [`${P}own`, 3, null],        // the editor's own image, not from Sanity
    ])
  })

  it('takes every Sanity image away when Sanity\'s gallery is empty, and still counts the node', async () => {
    const [{ n }] = await run(galleryQuery(LOCATION), { rows: [{ id: `${P}sid`, images: [] }] })
    expect(neo4j.isInt(n) ? n.toNumber() : n).toBe(1)
    const rows = await run(`MATCH (:Location {sanityId: $id})-[:HAS_IMAGE]->(i:Source) RETURN i.id AS id`, { id: `${P}sid` })
    expect(rows.map(r => r.id)).toEqual([`${P}own`])
  })

  it('renames in two phases, keeps the old slug as an alias and moves the description id', async () => {
    const renames = [{ id: `${P}sid`, from: `${P}old`, to: `${P}new` }]
    await run(renamePhaseQuery(LOCATION), { renames: renames.map(r => ({ id: r.id, to: `__renaming__${r.id}` })) })
    await run(renamePhaseQuery(LOCATION), { renames: renames.map(r => ({ id: r.id, to: r.to })) })
    await run(renameAliases(LOCATION.label, LOCATION.route), { renames: renames.map(r => ({ id: r.id, from: r.from })), at: '2026-10-16T00:00:00Z' })
    await run(dropShadowedAliases(LOCATION.label, LOCATION.route))

    const [node] = await run(`
      MATCH (n:Location {sanityId: $id})-[:HAS_CONTENT]->(d:Description)
      OPTIONAL MATCH (a:SlugAlias {route: '/map/'})-[:ALIAS_OF]->(n)
      RETURN n.slug AS slug, d.id AS desc, collect(a.slug) AS aliases`, { id: `${P}sid` })
    expect(node).toEqual({ slug: `${P}new`, desc: `desc:location:${P}new:1`, aliases: [`${P}old`] })
  })
})
