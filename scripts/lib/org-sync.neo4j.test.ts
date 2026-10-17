/**
 * The organization and district sync's writes against the local Neo4j (#300): properties and stamps applied to the right
 * node (a district only among the Units of type district), a new node created, sanityUpdatedAt kept back for a review, and
 * a color removed. Opt in with `npm run test:neo4j`.
 *
 * Safe by construction: localhost only, every node has a slug starting `zz-test-<run>-`, and everything made is removed
 * afterwards, and what a crashed run left is removed first.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import neo4j from 'neo4j-driver'
import { neo4jDriver } from './person-sync.ts'
import { DISTRICT, ORGANIZATION, applyQuery, createQuery, graphQuery, newOrgProps, planOrg, classifyOrg, stampsFor } from './org-sync.ts'

const ENABLED = process.env.NEO4J_TEST === '1'
const RUN = Math.random().toString(36).slice(2, 8)
const P = `zz-test-${RUN}-`

const driver = ENABLED ? neo4jDriver() : (null as never)
async function run(cypher: string, params: Record<string, unknown> = {}) {
  const s = driver.session({ defaultAccessMode: neo4j.session.WRITE })
  try { return (await s.run(cypher, params)).records.map(r => r.toObject()) } finally { await s.close() }
}
const cleanup = () => run(`MATCH (n) WHERE n.slug STARTS WITH 'zz-test-' DETACH DELETE n`)
const n = (v: unknown) => (neo4j.isInt(v) ? v.toNumber() : v)
const doc = (id: string, over: Record<string, unknown> = {}) => ({ _id: `${P}${id}`, _updatedAt: '2026-10-04T00:00:00Z', name: '09-Prøveorg', color: { hex: '#112233' }, ...over })

describe.skipIf(!ENABLED)('org sync writes, against the local Neo4j', () => {
  beforeAll(async () => {
    const host = (process.env.NEO4J_URI ?? '').replace(/^[a-z0-9+.-]+:\/\//, '').replace(/[:/].*$/, '')
    if (!/^(localhost|127\.0\.0\.1|::1)$/.test(host)) throw new Error(`NEO4J_URI points at ${host}: this test only runs against localhost`)
    await cleanup()
    await run(`
      CREATE (:Organization {slug: $p + 'org', sanityId: $p + 'org', canonicalName: 'Prøveorg', sortPrefix: '09', rawName: '09-Prøveorg', color: '#112233', sanityUpdatedAt: '2026-04-08T00:00:00Z'})
      CREATE (:Unit {slug: $p + 'dist', sanityId: $p + 'dist', type: 'district', canonicalName: 'Prøvedistrikt', sanityUpdatedAt: '2026-04-08T00:00:00Z'})
      CREATE (:Unit {slug: $p + 'troop', sanityId: $p + 'troop', type: 'troop', canonicalName: 'Ikke distrikt'})`, { p: P })
  })
  afterAll(async () => { await cleanup(); await driver.close() })

  it('reads an organization, and only the Units that are districts', async () => {
    const orgs = (await run(graphQuery(ORGANIZATION))).map(r => r.sanityId)
    const districts = (await run(graphQuery(DISTRICT))).map(r => r.sanityId)
    expect(orgs).toContain(`${P}org`)
    expect(districts).toContain(`${P}dist`)
    expect(districts).not.toContain(`${P}troop`)
    expect(districts).not.toContain(`${P}org`)
  })

  it('applies a clean change with its stamp, and removes a colour Sanity no longer has', async () => {
    const before = doc('org')
    const s = doc('org', { name: '10-Prøveorg', color: undefined })
    const g = { sanityId: s._id, sanityUpdatedAt: '2026-04-08T00:00:00Z', slug: `${P}org`, canonicalName: 'Prøveorg', sortPrefix: '09', color: '#112233', stamps: stampsFor(ORGANIZATION, before) }
    const row = planOrg(ORGANIZATION, g, s, classifyOrg(ORGANIZATION, g, s), [])!
    const [{ n: count }] = await run(applyQuery(ORGANIZATION), { rows: [{ id: row.id, props: row.props, stamps: row.stamps, at: row.at }] })
    expect(n(count)).toBe(1)
    const [node] = await run(`MATCH (o:Organization {sanityId: $id}) RETURN properties(o) AS p`, { id: s._id })
    expect(node.p).toMatchObject({ canonicalName: 'Prøveorg', sortPrefix: '10', rawName: '10-Prøveorg', sanityUpdatedAt: s._updatedAt })
    expect((node.p as Record<string, unknown>).color).toBeUndefined()
    expect((node.p as Record<string, unknown>).color_sha).toBeDefined()
  })

  it('keeps sanityUpdatedAt where it was while a field is held for review', async () => {
    await run(applyQuery(DISTRICT), { rows: [{ id: `${P}dist`, props: {}, stamps: {}, at: null }] })
    const [node] = await run(`MATCH (u:Unit {sanityId: $id}) RETURN u.sanityUpdatedAt AS at`, { id: `${P}dist` })
    expect(node.at).toBe('2026-04-08T00:00:00Z')
  })

  it('creates a district as a Unit of type district and an organization as an Organization', async () => {
    const d = { _id: `${P}newdist`, _updatedAt: '2026-10-04T00:00:00Z', name: 'Nytt distrikt' }
    const o = doc('neworg', { name: 'Ny org' })
    for (const [kind, x] of [[DISTRICT, d], [ORGANIZATION, o]] as const) {
      const props = { ...newOrgProps(kind, x), slug: `${P}${x._id.slice(P.length)}` }
      const [{ n: count }] = await run(createQuery(kind), { rows: [{ props }] })
      expect(n(count)).toBe(1)
    }
    const [u] = await run(`MATCH (u:Unit {sanityId: $id}) RETURN u.type AS type, u.canonicalName AS name, u.name_sha IS NOT NULL AS stamped`, { id: d._id })
    expect(u).toMatchObject({ type: 'district', name: 'Nytt distrikt', stamped: true })
    const [org] = await run(`MATCH (o:Organization {sanityId: $id}) RETURN o.canonicalName AS name, o.sortPrefix AS prefix, o.color AS color`, { id: o._id })
    expect(org).toMatchObject({ name: 'Ny org', color: '#112233' })
    expect(org.prefix).toBeNull()
  })
})
