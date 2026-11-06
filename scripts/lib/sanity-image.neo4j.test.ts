/**
 * The sync's "is this a Sanity photo" fragments against the local Neo4j (#413). Opt in with `npm run test:neo4j`.
 * A photo copied by the backfill (#412) must still count, and still be named by its Sanity key.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import neo4j from 'neo4j-driver'
import { neo4jDriver } from './person-sync.ts'
import { isSanityImage, sanityImageKey } from './sanity-image.ts'

const ENABLED = process.env.NEO4J_TEST === '1'
const P = `zz-test-${Math.random().toString(36).slice(2, 8)}-`
const CDN = 'https://cdn.sanity.io/images/7r6kqtqy/production/'

const driver = ENABLED ? neo4jDriver() : (null as never)
async function run(cypher: string, params: Record<string, unknown> = {}) {
  const s = driver.session({ defaultAccessMode: neo4j.session.WRITE })
  try { return (await s.run(cypher, params)).records.map(r => r.toObject()) } finally { await s.close() }
}
const cleanup = () => run(`MATCH (n) WHERE n.id STARTS WITH 'zz-test-' DETACH DELETE n`)

describe.skipIf(!ENABLED)('Sanity image fragments, against the local Neo4j', () => {
  beforeAll(async () => {
    const host = (process.env.NEO4J_URI ?? '').replace(/^[a-z0-9+.-]+:\/\//, '').replace(/[:/].*$/, '')
    if (!/^(localhost|127\.0\.0\.1|::1)$/.test(host)) throw new Error(`NEO4J_URI points at ${host}: this test only runs against localhost`)
    await cleanup()
    await run(`
      CREATE (:Source {id: $p + 'new', url: $cdn + 'aaa-1x1.png'})
      CREATE (:Source {id: 'img:sanity:' + $p + 'copied', url: '/images/x', sanityKey: 'bbb-2x2.jpg'})
      CREATE (:Source {id: $p + 'editor', url: 'https://example.org/x.jpg'})`, { p: P, cdn: CDN })
  })
  afterAll(async () => { await cleanup(); await driver.close() })

  it('matches a photo before and after the copy, not an editor\'s', async () => {
    const rows = await run(`
      MATCH (s:Source) WHERE s.id CONTAINS $p
      RETURN s.id AS id, ${isSanityImage('s')} AS sanity, ${sanityImageKey('s')} AS key`, { p: P })
    const by = Object.fromEntries(rows.map(r => [String(r.id).replace(/^.*zz-test-[a-z0-9]+-/, ''), r]))
    expect(by.new).toMatchObject({ sanity: true, key: 'aaa-1x1.png' })
    expect(by.copied).toMatchObject({ sanity: true, key: 'bbb-2x2.jpg' })
    expect(by.editor.sanity).toBe(false)
  })
})
