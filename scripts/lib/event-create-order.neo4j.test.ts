/**
 * A new event written by the sync's create path keeps its people in Sanity's order (#399). Opt in with
 * `npm run test:neo4j`.
 *
 * Safe by construction: localhost only, every node has a slug or sanityId starting `zz-test-<run>-`, and everything
 * made is removed afterwards, and what a crashed run left is removed first.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import neo4j, { type ManagedTransaction } from 'neo4j-driver'
import { neo4jDriver } from './person-sync.ts'
import { writeEvent, type EventPlan } from './event-rule.ts'

const ENABLED = process.env.NEO4J_TEST === '1'
const RUN = Math.random().toString(36).slice(2, 8)
const P = `zz-test-${RUN}-`

const driver = ENABLED ? neo4jDriver() : (null as never)
async function run(cypher: string, params: Record<string, unknown> = {}) {
  const s = driver.session({ defaultAccessMode: neo4j.session.WRITE })
  try { return (await s.run(cypher, params)).records.map(r => r.toObject()) } finally { await s.close() }
}
const cleanup = () => run(`MATCH (n) WHERE n.slug STARTS WITH 'zz-test-' OR n.sanityId STARTS WITH 'zz-test-' DETACH DELETE n`)

const plan = (id: string, people: string[]): EventPlan => ({
  sanityId: id, node: { slug: `${id}-slug`, sanityId: id, name: id },
  single: [], people, transport: [], images: [], links: [], description: null, unresolved: [],
})

describe.skipIf(!ENABLED)('writeEvent people order, against the local Neo4j', () => {
  beforeAll(async () => {
    const host = (process.env.NEO4J_URI ?? '').replace(/^[a-z0-9+.-]+:\/\//, '').replace(/[:/].*$/, '')
    if (!/^(localhost|127\.0\.0\.1|::1)$/.test(host)) throw new Error(`NEO4J_URI points at ${host}: this test only runs against localhost`)
    await cleanup()
    await run(`
      CREATE (:Person {slug: $p + 'a', canonicalName: 'Aa'}), (:Person {slug: $p + 'b', canonicalName: 'Bb'}),
             (:Person {slug: $p + 'c', canonicalName: 'Cc'})`, { p: P })
  })
  afterAll(async () => { await cleanup(); await driver.close() })

  const write = (p: EventPlan) => {
    const s = driver.session({ defaultAccessMode: neo4j.session.WRITE })
    return s.executeWrite((tx: ManagedTransaction) => writeEvent(tx, p, {})).finally(() => s.close())
  }
  const orders = async (id: string) => (await run(`
    MATCH (p:Person)-[r:PARTICIPATED_IN]->(:Operation {sanityId: $id})
    RETURN p.slug AS slug, r.order AS order ORDER BY r.order`, { id })).map(r => [r.slug, Number(r.order)])

  it('numbers the people from 1 in the plan\'s order, not by name', async () => {
    const id = `${P}ev1`
    await write(plan(id, [`${P}c`, `${P}a`, `${P}b`]))
    expect(await orders(id)).toEqual([[`${P}c`, 1], [`${P}a`, 2], [`${P}b`, 3]])
  })

  it('creates an event with no people', async () => {
    const id = `${P}ev2`
    await write(plan(id, []))
    expect(await orders(id)).toEqual([])
    const [{ n }] = await run(`MATCH (e:Operation {sanityId: $id}) RETURN count(e) AS n`, { id })
    expect(Number(n)).toBe(1)
  })
})
