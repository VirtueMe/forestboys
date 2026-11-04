/**
 * The people on the /events panel come in the order an editor set (#395), not by name, one row per person.
 * Runs the query the panel uses against the local Neo4j. Opt in with `npm run test:neo4j`.
 *
 * Safe by construction: localhost only, every node has a slug starting `zz-test-<run>-`, and everything made is removed
 * afterwards, and what a crashed run left is removed first.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import neo4j from 'neo4j-driver'
import { neo4jDriver } from './person-sync.ts'
import { eventPeopleQuery } from '../../src/composables/useEventsList.ts'

const ENABLED = process.env.NEO4J_TEST === '1'
const RUN = Math.random().toString(36).slice(2, 8)
const P = `zz-test-${RUN}-`

const driver = ENABLED ? neo4jDriver() : (null as never)
async function run(cypher: string, params: Record<string, unknown> = {}) {
  const s = driver.session({ defaultAccessMode: neo4j.session.WRITE })
  try { return (await s.run(cypher, params)).records.map(r => r.toObject()) } finally { await s.close() }
}
const cleanup = () => run(`MATCH (n) WHERE n.slug STARTS WITH 'zz-test-' DETACH DELETE n`)
const strip = (slugs: unknown[]) => slugs.map(s => String(s).slice(P.length))

describe.skipIf(!ENABLED)('the people of an event on the /events panel, against the local Neo4j', () => {
  beforeAll(async () => {
    const host = (process.env.NEO4J_URI ?? '').replace(/^[a-z0-9+.-]+:\/\//, '').replace(/[:/].*$/, '')
    if (!/^(localhost|127\.0\.0\.1|::1)$/.test(host)) throw new Error(`NEO4J_URI points at ${host}: this test only runs against localhost`)
    await cleanup()
    await run(`
      CREATE (op:Operation {slug: $p + 'op'}), (inc:Incident {slug: $p + 'inc'})
      CREATE (a:Person {slug: $p + 'a', canonicalName: 'Aa'}), (b:Person {slug: $p + 'b', canonicalName: 'Bb'}),
             (c:Person {slug: $p + 'c', canonicalName: 'Cc'}), (d:Person {slug: $p + 'd', canonicalName: 'Dd'})
      // c first, a second, b and d have no order and follow by name
      CREATE (a)-[:PARTICIPATED_IN {order: 2}]->(op), (c)-[:PARTICIPATED_IN {order: 1}]->(op),
             (b)-[:PARTICIPATED_IN]->(op), (d)-[:PARTICIPATED_IN]->(op)
      CREATE (d)-[:INVOLVED_IN {order: 2}]->(inc), (a)-[:INVOLVED_IN {order: 1}]->(inc)`, { p: P })
  })
  afterAll(async () => { await cleanup(); await driver.close() })

  it('lists an operation\'s people by order, the ones without an order after, by name', async () => {
    const rows = await run(eventPeopleQuery('Operation'), { slug: `${P}op` })
    expect(strip(rows.map(r => r.slug))).toEqual(['c', 'a', 'b', 'd'])
  })

  it('lists an incident\'s people by order', async () => {
    const rows = await run(eventPeopleQuery('Incident'), { slug: `${P}inc` })
    expect(strip(rows.map(r => r.slug))).toEqual(['a', 'd'])
  })
})
