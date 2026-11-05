/**
 * The transport order against the local Neo4j (#398): Sanity's order set on USED edges without one, an order an editor
 * saved left alone, a second run a no-op, and the read the editor and /events panel use. Opt in with `npm run test:neo4j`.
 *
 * Safe by construction: localhost only, every node has a slug or sanityId starting `zz-test-<run>-`, and everything
 * made is removed afterwards, and what a crashed run left is removed first.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import neo4j from 'neo4j-driver'
import { neo4jDriver } from './person-sync.ts'
import { TRANSPORT_ORDER_QUERY, TRANSPORT_ORDER_COUNT_QUERY } from './event-transport-order.ts'
import { EVENT_TRANSPORT_QUERY } from '../../src/composables/orderedMemberQueries.ts'

const ENABLED = process.env.NEO4J_TEST === '1'
const RUN = Math.random().toString(36).slice(2, 8)
const P = `zz-test-${RUN}-`

const driver = ENABLED ? neo4jDriver() : (null as never)
async function run(cypher: string, params: Record<string, unknown> = {}) {
  const s = driver.session({ defaultAccessMode: neo4j.session.WRITE })
  try { return (await s.run(cypher, params)).records.map(r => r.toObject()) } finally { await s.close() }
}
const cleanup = () => run(`MATCH (n) WHERE n.slug STARTS WITH 'zz-test-' OR n.sanityId STARTS WITH 'zz-test-' DETACH DELETE n`)
const orders = async (label: string) => (await run(`
  MATCH (e:${label} {sanityId: $id})-[r:USED]->(t:Transport)
  RETURN t.slug AS slug, r.order AS order`, { id: `${P}${label}` })).map(r => [r.slug, r.order ?? null])
// The read the editor and the /events panel run: order first, the rest by name.
const listed = async (label: string) => (await run(EVENT_TRANSPORT_QUERY, { slug: `${P}${label === 'Operation' ? 'op' : 'inc'}` }))
  .map(r => String(r.targetSlug).slice(P.length))

describe.skipIf(!ENABLED)('transport order, against the local Neo4j', () => {
  beforeAll(async () => {
    const host = (process.env.NEO4J_URI ?? '').replace(/^[a-z0-9+.-]+:\/\//, '').replace(/[:/].*$/, '')
    if (!/^(localhost|127\.0\.0\.1|::1)$/.test(host)) throw new Error(`NEO4J_URI points at ${host}: this test only runs against localhost`)
    await cleanup()
    await run(`
      CREATE (op:Operation {slug: $p + 'op', sanityId: $p + 'Operation'})
      CREATE (inc:Incident {slug: $p + 'inc', sanityId: $p + 'Incident'})
      CREATE (a:Transport {slug: $p + 'a', canonicalName: 'Aa'}), (b:Transport {slug: $p + 'b', canonicalName: 'Bb'}),
             (c:Transport {slug: $p + 'c', canonicalName: 'Cc'}), (d:Transport {slug: $p + 'd', canonicalName: 'Dd'})
      CREATE (op)-[:USED]->(a), (op)-[:USED]->(b), (op)-[:USED {order: 1}]->(c), (op)-[:USED]->(d)
      CREATE (inc)-[:USED]->(a), (inc)-[:USED]->(b)`, { p: P })
  })
  afterAll(async () => { await cleanup(); await driver.close() })

  // Sanity: d, b, a on the operation (c is an editor's, saved at 1), b, a on the incident.
  const rows = () => [
    { event: `${P}Operation`, transport: [`${P}d`, `${P}b`, `${P}a`] },
    { event: `${P}Incident`,  transport: [`${P}b`, `${P}a`] },
  ]

  it('lists by name while no edge has an order', async () => {
    expect(await listed('Incident')).toEqual(['a', 'b'])
  })

  it('counts without writing, then writes only edges without an order', async () => {
    const [{ n: count }] = await run(TRANSPORT_ORDER_COUNT_QUERY, { rows: rows() })
    expect(count).toBe(5)
    expect((await orders('Incident')).every(([, o]) => o === null)).toBe(true)

    const [{ n }] = await run(TRANSPORT_ORDER_QUERY, { rows: rows() })
    expect(n).toBe(5)
    const op = Object.fromEntries(await orders('Operation'))
    expect(op[`${P}d`]).toBe(1)
    expect(op[`${P}b`]).toBe(2)
    expect(op[`${P}a`]).toBe(3)
  })

  it('leaves an order an editor saved alone', async () => {
    const op = Object.fromEntries(await orders('Operation'))
    expect(op[`${P}c`]).toBe(1)
  })

  it('sorts by the order, not by name', async () => {
    expect(await listed('Incident')).toEqual(['b', 'a'])
  })

  it('is a no-op the second time', async () => {
    const [{ n }] = await run(TRANSPORT_ORDER_QUERY, { rows: rows() })
    expect(n).toBe(0)
  })
})
