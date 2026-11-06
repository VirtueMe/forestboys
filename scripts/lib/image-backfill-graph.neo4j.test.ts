/**
 * The photo backfill's graph queries against the local Neo4j (#412). Opt in with `npm run test:neo4j`.
 *
 * Safe by construction: localhost only, every node has an id starting `zz-test-<run>-`, and everything made is removed
 * afterwards (and what a crashed run left, first).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import neo4j from 'neo4j-driver'
import { neo4jDriver } from './person-sync.ts'
import { DESCRIPTIONS_QUERY, SET_CONTENT_QUERY, SET_URL_QUERY, SOURCES_QUERY } from './image-backfill-graph.ts'

const ENABLED = process.env.NEO4J_TEST === '1'
const P = `zz-test-${Math.random().toString(36).slice(2, 8)}-`
const CDN = 'https://cdn.sanity.io/images/7r6kqtqy/production/'

const driver = ENABLED ? neo4jDriver() : (null as never)
async function run(cypher: string, params: Record<string, unknown> = {}) {
  const s = driver.session({ defaultAccessMode: neo4j.session.WRITE })
  try { return (await s.run(cypher, params)).records.map(r => r.toObject()) } finally { await s.close() }
}
const cleanup = () => run(`MATCH (n) WHERE n.id STARTS WITH 'zz-test-' OR n.slug STARTS WITH 'zz-test-' DETACH DELETE n`)
const n = (v: unknown) => (neo4j.isInt(v) ? v.toNumber() : v)

describe.skipIf(!ENABLED)('image backfill queries, against the local Neo4j', () => {
  beforeAll(async () => {
    const host = (process.env.NEO4J_URI ?? '').replace(/^[a-z0-9+.-]+:\/\//, '').replace(/[:/].*$/, '')
    if (!/^(localhost|127\.0\.0\.1|::1)$/.test(host)) throw new Error(`NEO4J_URI points at ${host}: this test only runs against localhost`)
    await cleanup()
    await run(`
      CREATE (p:Person {slug: $p + 'p', id: $p + 'p'})
      CREATE (p)-[:HAS_IMAGE {order: 1}]->(:Source {id: $p + 'a', url: $cdn + 'a-1x1.png', sanityAssetRef: 'image-a-1x1-png'})
      CREATE (c:Card {id: $p + 'c'})-[:HAS_HERO_IMAGE]->(:Source {id: $p + 'h', url: $cdn + 'h-1x1.jpg'})
      CREATE (:Source {id: $p + 'loose', url: $cdn + 'l-1x1.gif'})
      CREATE (:Source {id: $p + 'ours', url: '/images/x'})
      CREATE (:Source {id: $p + 'link', url: 'https://example.org/x'})
      CREATE (d:Description {id: $p + 'd', content: 'before ' + $cdn + 'a-1x1.png?w=1280'})
      CREATE (:Description {id: $p + 'plain', content: 'nothing'})`, { p: P, cdn: CDN })
  })
  afterAll(async () => { await cleanup(); await driver.close() })

  it('lists Sanity sources with the places that reach them, and leaves ours and other links out', async () => {
    const rows = (await run(SOURCES_QUERY)).filter(r => String(r.id).startsWith(P))
    expect(rows.map(r => [r.id, r.places])).toEqual([
      [`${P}a`, ['HAS_IMAGE:Person']],
      [`${P}h`, ['HAS_HERO_IMAGE:Card']],
      [`${P}loose`, []],
    ])
  })

  it('points a source at the bucket and keeps the key; a repeat and an edited address are untouched', async () => {
    const rows = [{ id: `${P}a`, url: '/images/aaa', key: 'a-1x1.png' }]
    expect(n((await run(SET_URL_QUERY, { rows }))[0].n)).toBe(1)
    expect(n((await run(SET_URL_QUERY, { rows }))[0].n)).toBe(0)
    const [s] = await run(`MATCH (s:Source {id: $id}) RETURN s.url AS url, s.sanityKey AS key, s.sanityAssetRef AS ref`, { id: `${P}a` })
    expect(s).toEqual({ url: '/images/aaa', key: 'a-1x1.png', ref: 'image-a-1x1-png' })
  })

  it('finds descriptions that name the CDN and replaces text only if unchanged', async () => {
    const found = (await run(DESCRIPTIONS_QUERY)).filter(r => String(r.id).startsWith(P))
    expect(found.map(r => r.id)).toEqual([`${P}d`])
    const before = String(found[0].content)
    expect(n((await run(SET_CONTENT_QUERY, { rows: [{ id: `${P}d`, before: 'stale', after: 'x' }] }))[0].n)).toBe(0)
    expect(n((await run(SET_CONTENT_QUERY, { rows: [{ id: `${P}d`, before, after: 'after' }] }))[0].n)).toBe(1)
    const [d] = await run(`MATCH (d:Description {id: $id}) RETURN d.content AS c`, { id: `${P}d` })
    expect(d.c).toBe('after')
  })
})
