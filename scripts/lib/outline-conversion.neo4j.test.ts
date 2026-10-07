/**
 * The conversion's reading and removal against the local Neo4j (what mocks cannot say: the Cypher is valid and does
 * what it claims). Opt in with `npm run test:neo4j`.
 *
 * Safe by construction: localhost only, every node has a slug or id starting `zz-test-<run>-`, and the nodes are
 * marked with a property of the test's own (not `sanityOutlineId`), so the real nodes made from outlines are never read,
 * counted or removed. Everything made is removed afterwards, and what a crashed run left is removed first. That cleanup
 * is the same one the apply test has (every `zz-test-` node), so `npm run test:neo4j` runs the files one at a time.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import neo4j from 'neo4j-driver'
import { neo4jDriver } from './person-sync.ts'
import { buildArchive, buildOutlineBundle, checkAgainstArchive, countGraph, readConversion, removeConverted } from './outline-conversion.ts'
import { outlineContentSha } from '../../functions/_lib/outline-sha.ts'

const ENABLED = process.env.NEO4J_TEST === '1'
const RUN = Math.random().toString(36).slice(2, 8)
const P = `zz-test-${RUN}-`
const MARKER = `sanityOutlineIdzz${RUN}`
const SITE = 'https://archive.example'
const BLOCKS = (t: string) => JSON.stringify([{ _type: 'block', _key: 'a', children: [{ _type: 'span', _key: 's', text: t }] }])
const OUTLINE_TEXT = BLOCKS('Disposisjon.')

const driver = ENABLED ? neo4jDriver() : (null as never)
const session = () => driver.session({ defaultAccessMode: neo4j.session.WRITE })

async function run(cypher: string, params: Record<string, unknown> = {}) {
  const s = session()
  try { return (await s.run(cypher, params)).records } finally { await s.close() }
}
const cleanup = () => run(`MATCH (n) WHERE n.slug STARTS WITH 'zz-test-' OR n.id STARTS WITH 'zz-test-' DETACH DELETE n`)

describe.skipIf(!ENABLED)('outline conversion, against the local Neo4j', () => {
  beforeAll(async () => {
    const host = (process.env.NEO4J_URI ?? '').replace(/^[a-z0-9+.-]+:\/\//, '').replace(/[:/].*$/, '')
    if (!/^(localhost|127\.0\.0\.1|::1)$/.test(host)) throw new Error(`NEO4J_URI points at ${host}: this test only runs against localhost`)
    await cleanup()
    await run(`
      CREATE (o:Outline {slug: $p + 'outline', sanityId: $p + 'oid'})
      CREATE (od:Description {id: $p + 'od', order: 1, content: $text})
      CREATE (o)-[:HAS_CONTENT]->(od)
      CREATE (u:Unit {slug: $p + 'unit', canonicalName: 'Testenhet', sanityId: 'real-sanity-id', sanityUpdatedAt: 'x'}) SET u.\`${MARKER}\` = $p + 'oid'
      CREATE (d:Description {id: $p + 'd', order: 1, content: $text, author: 'x'}) SET d.\`${MARKER}\` = $p + 'oid'
      CREATE (d)-[:ABOUT]->(u)
      CREATE (org:Organization {slug: $p + 'org'})
      CREATE (u)-[:PART_OF {role: 'x'}]->(org)
      CREATE (p1:Person {slug: $p + 'ole'})
      CREATE (p2:Person {slug: $p + 'padded '})
      CREATE (p3:Person {slug: $p + 'stray'})
      CREATE (p1)-[:MEMBER_OF {state: 'verified', sourceRef: 'linge-outline-membership'}]->(u)
      CREATE (p2)-[:MEMBER_OF {state: 'verified', sourceRef: 'linge-outline-membership'}]->(u)
      CREATE (p3)-[:MEMBER_OF]->(u)
      CREATE (note:Description {id: $p + 'note', order: 1, content: $text})
      CREATE (note)-[:ABOUT_UNIT]->(u)
      CREATE (other:Unit {slug: $p + 'course'})
      CREATE (other)-[:PART_OF]->(u)`, { p: P, text: OUTLINE_TEXT })
  })
  afterAll(async () => { await cleanup(); await driver.close() })

  it('reads the node, its description, its edges both ways, and says what it leaves out and why', async () => {
    const s = session()
    try {
      const c = await readConversion(s, SITE, MARKER)
      expect(c.groups).toHaveLength(1)
      const g = c.groups[0]
      expect(g.outlineSlug).toBe(`${P}outline`)
      expect(g.outlineSha).toBe(await outlineContentSha([{ order: 1, content: OUTLINE_TEXT }]))
      expect(g.entity.key).toBe(`${P}unit`)
      expect(g.entity.props).toEqual({ canonicalName: 'Testenhet' })
      expect(g.entity.descriptions).toEqual([{ order: 1, content: OUTLINE_TEXT }])
      expect(g.entity.edges).toEqual([{ type: 'PART_OF', to: `Organization:${P}org`, props: { role: 'x' } }])
      expect(g.inbound.map(i => `${i.from} ${i.type}`)).toEqual([`Person:${P}ole MEMBER_OF`, `Unit:${P}course PART_OF`])
      expect(c.unlinked.map(u => u.reason).sort()).toEqual(['bad-slug', 'not-entity', 'not-ours'])
      expect(c.raw.nodes).toHaveLength(2)
      expect(c.raw.edges).toHaveLength(7)
      expect(JSON.stringify(g)).not.toMatch(/real-sanity-id|sanityUpdatedAt/)
    } finally { await s.close() }
  })

  it('makes bundles that hold what the archive holds', async () => {
    const s = session()
    try {
      const c = await readConversion(s, SITE, MARKER)
      const now = '2026-10-07T12:00:00.000Z'
      expect(checkAgainstArchive(buildArchive(c, SITE, now), c.groups.map(g => buildOutlineBundle(g, now)))).toEqual([])
    } finally { await s.close() }
  })

  it('removes the nodes and the edges that touch them, in one transaction, and nothing else', async () => {
    const s = session()
    try {
      const c = await readConversion(s, SITE, MARKER)
      const expected = { nodes: c.raw.nodes.length, edges: c.raw.edges.length }

      // A wrong count refuses and changes nothing.
      const before = await countGraph(s, MARKER)
      await expect(removeConverted(s, { nodes: expected.nodes, edges: expected.edges + 1 }, MARKER)).rejects.toThrow(/rolled back/)
      expect(await countGraph(s, MARKER)).toEqual(before)

      const r = await removeConverted(s, expected, MARKER)
      expect(r.after.converted).toBe(0)
      expect(r.before.nodes - r.after.nodes).toBe(2)
      expect(r.before.edges - r.after.edges).toBe(7)
      // What stays: the outline and its text, the organization, the three people, the other unit and the membership note.
      const left = await run(`MATCH (n) WHERE n.slug STARTS WITH $p OR n.id STARTS WITH $p RETURN count(n) AS n`, { p: P })
      expect(Number(left[0].get('n'))).toBe(8)
    } finally { await s.close() }
  })
})
