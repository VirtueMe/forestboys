/**
 * The outline sync's writes against the local Neo4j (#301): a node made with its Description, mentions added and none
 * removed, a gallery replaced without touching what an editor added. Opt in with `npm run test:neo4j`.
 *
 * Safe by construction: localhost only, every node has a slug or id starting `zz-test-<run>-` (the Description's id holds it
 * after `desc:Outline:`), and everything made is removed afterwards, and what a crashed run left is removed first.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import neo4j from 'neo4j-driver'
import { neo4jDriver } from './person-sync.ts'
import { APPLY_QUERY, CREATE_QUERY, GALLERY_QUERY, GRAPH_QUERY, MENTIONS_QUERY, newOutlineProps } from './outline-sync.ts'

const ENABLED = process.env.NEO4J_TEST === '1'
const RUN = Math.random().toString(36).slice(2, 8)
const P = `zz-test-${RUN}-`
const CDN = 'https://cdn.sanity.io/images/7r6kqtqy/production/'

const driver = ENABLED ? neo4jDriver() : (null as never)
async function run(cypher: string, params: Record<string, unknown> = {}) {
  const s = driver.session({ defaultAccessMode: neo4j.session.WRITE })
  try { return (await s.run(cypher, params)).records.map(r => r.toObject()) } finally { await s.close() }
}
const cleanup = () => run(`MATCH (n) WHERE n.slug STARTS WITH 'zz-test-' OR n.id STARTS WITH 'zz-test-' OR n.id STARTS WITH 'desc:Outline:zz-test-' DETACH DELETE n`)
const n = (v: unknown) => (neo4j.isInt(v) ? v.toNumber() : v)

describe.skipIf(!ENABLED)('outline sync writes, against the local Neo4j', () => {
  beforeAll(async () => {
    const host = (process.env.NEO4J_URI ?? '').replace(/^[a-z0-9+.-]+:\/\//, '').replace(/[:/].*$/, '')
    if (!/^(localhost|127\.0\.0\.1|::1)$/.test(host)) throw new Error(`NEO4J_URI points at ${host}: this test only runs against localhost`)
    await cleanup()
    await run(`
      CREATE (o:Outline {slug: $p + 'old', sanityId: $p + 'oid', canonicalName: 'Gammel'})
      CREATE (o)-[:MENTIONS]->(:Person {slug: $p + 'extra', sanityId: $p + 'extra'})
      CREATE (o)-[:HAS_IMAGE {order: 1}]->(:Source {id: $p + 'img-a', url: $cdn + 'a.png', type: 'photograph'})
      CREATE (o)-[:HAS_IMAGE {order: 2, isHero: true}]->(:Source {id: $p + 'img-b', url: $cdn + 'b.png', type: 'photograph'})
      CREATE (o)-[:HAS_IMAGE {order: 3}]->(:Source {id: $p + 'own', url: 'https://example.org/own.jpg', type: 'photograph'})
      CREATE (:Person {slug: $p + 'p1', sanityId: $p + 'p1'})`, { p: P, cdn: CDN })
  })
  afterAll(async () => { await cleanup(); await driver.close() })

  it('reads the mentions, the Sanity images and the stamps of an outline', async () => {
    const row = (await run(GRAPH_QUERY)).find(r => r.sanityId === `${P}oid`)!
    expect(row.mentions).toEqual([`${P}extra`])
    expect((row.imageRefs as string[]).length).toBe(2)   // the editor's own image is not a Sanity one
    expect(row.canonicalName).toBe('Gammel')
  })

  it('applies a title and stamps, adds a mention and removes none', async () => {
    const [{ n: a }] = await run(APPLY_QUERY, { rows: [{ id: `${P}oid`, props: { canonicalName: 'Ny' }, stamps: { title_sha: 'x' } }] })
    expect(n(a)).toBe(1)
    const [{ n: b }] = await run(MENTIONS_QUERY, { rows: [{ id: `${P}oid`, people: [`${P}p1`, `${P}missing`] }] })
    expect(n(b)).toBe(1)
    const [o] = await run(`MATCH (o:Outline {sanityId: $id}) RETURN o.canonicalName AS name, o.title_sha AS sha, [(o)-[:MENTIONS]->(p) | p.sanityId] AS m`, { id: `${P}oid` })
    expect(o).toMatchObject({ name: 'Ny', sha: 'x' })
    expect([...(o.m as string[])].sort()).toEqual([`${P}extra`, `${P}p1`])
  })

  it('replaces the Sanity images by Sanity\'s gallery and leaves an editor\'s image and settings alone', async () => {
    const images = [
      { id: `${P}img-b`, url: `${CDN}b.png`, assetRef: `${P}b`, order: 1 },
      { id: `${P}img-c`, url: `${CDN}c.png`, assetRef: `${P}c`, order: 2 },
    ]
    const [{ n: count }] = await run(GALLERY_QUERY, { rows: [{ id: `${P}oid`, images }] })
    expect(n(count)).toBe(1)
    const rows = await run(`MATCH (:Outline {sanityId: $id})-[h:HAS_IMAGE]->(i:Source) RETURN i.id AS id, h.order AS order, h.isHero AS hero ORDER BY id`, { id: `${P}oid` })
    expect(rows.map(r => [r.id, n(r.order), r.hero ?? null])).toEqual([[`${P}img-b`, 1, true], [`${P}img-c`, 2, null], [`${P}own`, 3, null]])
  })

  it('makes a node with its single Description', async () => {
    const d = { _id: `${P}newid`, _rev: 'r', _updatedAt: '2026-10-04T00:00:00Z', title: 'Ny disposisjon', slug: { current: `${P}new` } }
    const [{ n: count }] = await run(CREATE_QUERY, { rows: [{ props: newOutlineProps(d, new Set()), descId: `desc:Outline:${P}new:1`, content: '[]' }] })
    expect(n(count)).toBe(1)
    const [o] = await run(`MATCH (o:Outline {sanityId: $id})-[:HAS_CONTENT]->(d:Description) RETURN o.canonicalName AS name, d.id AS id, d.order AS ord, d.content AS content, o.title_sha IS NOT NULL AS stamped`, { id: d._id })
    expect(o).toMatchObject({ name: 'Ny disposisjon', id: `desc:Outline:${P}new:1`, content: '[]', stamped: true })
    expect(n(o.ord)).toBe(1)
  })
})
