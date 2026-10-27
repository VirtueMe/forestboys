/**
 * The hand-set order of an organisation's units, a unit's members and a course's people, against the local Neo4j (#355): the position
 * wins over a description, an edge without an order follows, and the unit's page lists its own members before those of
 * its sub-units. Runs the queries the editors and the page use. Opt in with `npm run test:neo4j`.
 *
 * Safe by construction: localhost only, every node has a slug or id starting `zz-test-<run>-`, and everything made is
 * removed afterwards, and what a crashed run left is removed first.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import neo4j from 'neo4j-driver'
import { neo4jDriver } from './person-sync.ts'
import { ORG_UNITS_QUERY, UNIT_ATTENDEES_QUERY, UNIT_MEMBERS_QUERY, UNIT_MEMBERS_PAGE_QUERY } from '../../src/composables/orderedMemberQueries.ts'

const ENABLED = process.env.NEO4J_TEST === '1'
const RUN = Math.random().toString(36).slice(2, 8)
const P = `zz-test-${RUN}-`

const driver = ENABLED ? neo4jDriver() : (null as never)
async function run(cypher: string, params: Record<string, unknown> = {}) {
  const s = driver.session({ defaultAccessMode: neo4j.session.WRITE })
  try { return (await s.run(cypher, params)).records.map(r => r.toObject()) } finally { await s.close() }
}
const cleanup = () => run(`MATCH (n) WHERE n.slug STARTS WITH 'zz-test-' OR n.id STARTS WITH 'zz-test-' DETACH DELETE n`)
const strip = (slugs: unknown[]) => slugs.map(s => String(s).slice(P.length))

describe.skipIf(!ENABLED)('hand-set order of units and members, against the local Neo4j', () => {
  beforeAll(async () => {
    const host = (process.env.NEO4J_URI ?? '').replace(/^[a-z0-9+.-]+:\/\//, '').replace(/[:/].*$/, '')
    if (!/^(localhost|127\.0\.0\.1|::1)$/.test(host)) throw new Error(`NEO4J_URI points at ${host}: this test only runs against localhost`)
    await cleanup()
    await run(`
      CREATE (o:Organization {slug: $p + 'org', canonicalName: 'Org'})
      CREATE (u1:Unit {slug: $p + 'u1', canonicalName: 'Aa'}), (u2:Unit {slug: $p + 'u2', canonicalName: 'Bb'}),
             (u3:Unit {slug: $p + 'u3', canonicalName: 'Cc'})
      CREATE (u3)-[:PART_OF {order: 1}]->(o), (u1)-[:PART_OF {order: 2}]->(o), (u2)-[:PART_OF]->(o)
      // u1 has a note on this roster: it used to sort last for that
      CREATE (o)-[:HAS_MEMBER_UNIT_NOTE]->(:Description {id: $p + 'd1', order: 1, content: '[]'})-[:ABOUT_UNIT]->(u1)

      CREATE (top:Unit {slug: $p + 'top', canonicalName: 'Top'}), (sub:Unit {slug: $p + 'sub', canonicalName: 'Sub'})
      CREATE (sub)-[:PART_OF]->(top)
      CREATE (a:Person {slug: $p + 'a', canonicalName: 'Aa'}), (b:Person {slug: $p + 'b', canonicalName: 'Bb'}),
             (c:Person {slug: $p + 'c', canonicalName: 'Cc'}), (d:Person {slug: $p + 'd', canonicalName: 'Dd'}),
             (e:Person {slug: $p + 'e', canonicalName: 'Ee'})
      // b first, a second (a carries a description: it used to sort last), c by date, d and e after
      CREATE (a)-[:MEMBER_OF {order: 2, description: 'x'}]->(top), (b)-[:MEMBER_OF {order: 1}]->(top),
             (c)-[:MEMBER_OF {startDate: '1940'}]->(top), (d)-[:MEMBER_OF]->(top),
             (e)-[:MEMBER_OF {order: 1}]->(sub)

      // a course: all start together, so the order is the enrolment order; c and d have none
      CREATE (course:Unit {slug: $p + 'course', canonicalName: 'Course', type: 'course'})
      CREATE (a)-[:ATTENDED {startDate: '1941-03', order: 2}]->(course), (b)-[:ATTENDED {startDate: '1941-03', order: 1}]->(course),
             (c)-[:ATTENDED {startDate: '1941-03'}]->(course), (d)-[:ATTENDED {startDate: '1941-03'}]->(course)`, { p: P })
  })
  afterAll(async () => { await cleanup(); await driver.close() })

  it('lists an organisation\'s units by order, a note not sending a unit last', async () => {
    const rows = await run(ORG_UNITS_QUERY, { slug: `${P}org` })
    expect(strip(rows.map(r => r.targetSlug))).toEqual(['u3', 'u1', 'u2'])
  })

  it('lists a unit\'s own members by order, then date, then name', async () => {
    const rows = await run(UNIT_MEMBERS_QUERY, { slug: `${P}top` })
    expect(strip(rows.map(r => r.targetSlug))).toEqual(['b', 'a', 'c', 'd'])
  })

  it('lists the unit page\'s own members first, then the sub-units\' by name', async () => {
    const rows = await run(UNIT_MEMBERS_PAGE_QUERY, { slug: `${P}top` })
    // e is a member of the sub-unit with order 1: that is not an order on this unit
    expect(strip(rows.map(r => r.slug))).toEqual(['b', 'a', 'c', 'd', 'e'])
  })

  it('lists a course\'s people by enrolment order, the ones without by date and name', async () => {
    const rows = await run(UNIT_ATTENDEES_QUERY, { slug: `${P}course` })
    expect(strip(rows.map(r => r.targetSlug))).toEqual(['b', 'a', 'c', 'd'])
  })
})
