/**
 * The apply step against a real Neo4j (the local one): what the mocked tests in _apply.test.ts cannot say, that the
 * statements are valid Cypher and do what they claim. Opt in with `npm run test:neo4j`.
 *
 * Safe by construction: it refuses anything but localhost, every node it makes has a slug or id that starts with
 * `zz-test-<run>-`, nothing that is not such a node is read or changed, and everything it made is removed afterwards
 * (and what a crashed earlier run left behind is removed first).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'
import { stableSha } from '~/_lib/stable-sha.ts'
import { readOutlineVersion, readProduced, outlineContentSha } from '~/_lib/outline-version.ts'
import { applyEntityOps, archiveOutlineStatement, checkDescriptionDrift } from './_apply.ts'

// The settings come from vitest.config.ts (`test.env`), which reads .env only for `npm run test:neo4j`. Read through
// globalThis: this file is type-checked with the Cloudflare types, which have no `process`.
const E = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env
const ENABLED = E.NEO4J_TEST === '1'

const env = {
  NEO4J_URI: E.NEO4J_URI ?? '', NEO4J_HTTP_URI: E.NEO4J_HTTP_URI,
  NEO4J_USERNAME: E.NEO4J_USERNAME ?? '', NEO4J_PASSWORD: E.NEO4J_PASSWORD ?? '',
} as Neo4jEnv

const RUN = Math.random().toString(36).slice(2, 8)
const P = `zz-test-${RUN}-`
const AT = '2026-10-07T12:00:00.000Z'
const BLOCKS = (text: string) => JSON.stringify([{ _type: 'block', _key: 'a', children: [{ _type: 'span', _key: 's', text }] }])

type Ops = Parameters<typeof applyEntityOps>[2]['ops']
const payload = (entityId: string, ops: unknown[], derivedFrom: unknown) =>
  ({ entityId, ops, derivedFrom, source: 's', generatedAt: AT }) as Parameters<typeof applyEntityOps>[2]
const SYNC    = { sanityId: 'abc', sanityRev: 'r1' }
// One outline per test: what an outline produced is asked for by its slug, so tests must not share one.
const outline = (rev: string, slug = `${P}outline-a`) => ({ outlineId: slug, outlineRev: rev, sectionPath: 'overview' })
const apply = (entityId: string, ops: unknown[], derivedFrom: unknown, bundleId = `bundle:${P}x:t`) =>
  applyEntityOps(env, entityId, payload(entityId, ops, derivedFrom), bundleId, AT)
const props = async (label: string, key: 'slug' | 'id', value: string) =>
  (await runCypher<{ p: Record<string, unknown> | null }>(env, `OPTIONAL MATCH (n:\`${label}\` {${key}: $v}) RETURN properties(n) AS p`, { v: value }))[0]?.p ?? null
const edgeProps = async (type: string, from: string, to: string) =>
  (await runCypher<{ p: Record<string, unknown> | null }>(env, `OPTIONAL MATCH (a {slug: $a})-[r:\`${type}\`]->(b {slug: $b}) RETURN properties(r) AS p`, { a: from, b: to }))[0]?.p ?? null

async function cleanup() {
  await runCypher(env, `MATCH (n) WHERE n.slug STARTS WITH 'zz-test-' OR n.id STARTS WITH 'zz-test-' OR n.id CONTAINS ':zz-test-' DETACH DELETE n`, {})
}

describe.skipIf(!ENABLED)('apply, against the local Neo4j', () => {
  beforeAll(async () => {
    const host = env.NEO4J_URI.replace(/^[a-z0-9+.-]+:\/\//, '').replace(/[:/].*$/, '')
    if (!/^(localhost|127\.0\.0\.1|::1)$/.test(host)) throw new Error(`NEO4J_URI points at ${host}: this test only runs against localhost`)
    await cleanup()
  })
  afterAll(cleanup)

  it('stamps a node and its edges from an outline bundle, and writes no Sanity property', async () => {
    await apply(`Unit:${P}unit`, [{ op: 'create-entity', kind: 'Unit', slug: `${P}unit`, props: { canonicalName: 'Testenhet' } }], SYNC)
    await apply(`Operation:${P}op`, [{
      op: 'create-entity', kind: 'Operation', slug: `${P}op`, props: { canonicalName: 'Testoperasjon' },
      edges: [{ type: 'PART_OF', to: `Unit:${P}unit`, props: { role: 'test' } }],
      descriptions: [{ order: 1, content: BLOCKS('Tekst.') }],
    }], outline('hash1'), `bundle:${P}a:t`)

    const stamp = { originOutline: `${P}outline-a`, originSha: 'hash1', originBundle: `bundle:${P}a:t`, originSection: 'overview' }
    expect(await props('Operation', 'slug', `${P}op`)).toMatchObject({ canonicalName: 'Testoperasjon', slug: `${P}op`, ...stamp })
    expect(await edgeProps('PART_OF', `${P}op`, `${P}unit`)).toEqual({ role: 'test', ...stamp })
    const unit = await props('Unit', 'slug', `${P}unit`)
    expect(Object.keys(unit!).filter(k => /origin|importedFrom|sanity/i.test(k))).toEqual([])    // a sync bundle stamps nothing
    const d = await runCypher<{ c: string }>(env, `MATCH (:Operation {slug: $s})-[:HAS_CONTENT]->(d:Description) RETURN d.content AS c`, { s: `${P}op` })
    expect(d.map(r => r.c)).toEqual([BLOCKS('Tekst.')])
  })

  it('stamps importedFrom on what a package bundle creates', async () => {
    await apply(`Transport:${P}tr`, [{ op: 'create-entity', kind: 'Transport', slug: `${P}tr`, props: { regser: '683' } }],
      { source: { site: 'https://a.example', path: `/transport/${P}tr` } }, `bundle:package-a-example:t`)
    expect(await props('Transport', 'slug', `${P}tr`)).toMatchObject({
      regser: '683', importedFrom: `https://a.example/transport/${P}tr`, originBundle: 'bundle:package-a-example:t',
    })
  })

  it('add-edge stamps an edge it creates, and not one that was already there', async () => {
    await apply(`Unit:${P}a`, [{ op: 'create-entity', kind: 'Unit', slug: `${P}a`, props: {} }], SYNC)
    await apply(`Unit:${P}b`, [{ op: 'create-entity', kind: 'Unit', slug: `${P}b`, props: {} }], SYNC)
    await runCypher(env, `MATCH (a:Unit {slug: $a}), (b:Unit {slug: $b}) CREATE (a)-[:PART_OF {role: 'hand-made'}]->(b)`, { a: `${P}a`, b: `${P}b` })

    await apply(`Unit:${P}a`, [
      { op: 'add-edge', type: 'PART_OF', from: `Unit:${P}a`, to: `Unit:${P}b`, props: { note: 'merged' } },     // was there
      { op: 'add-edge', type: 'FEEDS_INTO', from: `Unit:${P}a`, to: `Unit:${P}b`, props: { note: 'new' } },     // is created
    ], outline('hash1'), `bundle:${P}b:t`)

    expect(await edgeProps('PART_OF', `${P}a`, `${P}b`)).toEqual({ role: 'hand-made', note: 'merged' })       // no origin: not this bundle's
    expect(await edgeProps('FEEDS_INTO', `${P}a`, `${P}b`)).toMatchObject({ note: 'new', originOutline: `${P}outline-a`, originBundle: `bundle:${P}b:t` })
  })

  it('set-description: checks drift, replaces the text and keeps the old, creates one that is missing', async () => {
    const old = BLOCKS('Gammel.')
    await apply(`Location:${P}loc`, [{ op: 'create-entity', kind: 'Location', slug: `${P}loc`, props: {}, descriptions: [{ order: 1, content: old }] }], SYNC)
    const sha = await stableSha(JSON.parse(old))
    const op = (expectedSha: string, order = 1, content = BLOCKS('Ny.')) => [{ op: 'set-description', order, expectedSha, content }]

    expect(await checkDescriptionDrift(env, `Location:${P}loc`, op(sha) as Ops)).toEqual([])
    expect(await checkDescriptionDrift(env, `Location:${P}loc`, op('stale') as Ops)).toEqual([{ prop: 'description 1', expected: 'stale', actual: sha }])
    expect(await checkDescriptionDrift(env, `Location:${P}loc`, op('', 2) as Ops)).toEqual([])                  // none there, none expected

    await apply(`Location:${P}loc`, [...op(sha), ...op('', 2, BLOCKS('To.'))], SYNC, `bundle:${P}c:t`)
    const rows = await runCypher<Record<string, unknown>>(env,
      `MATCH (:Location {slug: $s})-[:HAS_CONTENT]->(d:Description) RETURN d.order AS order, d.id AS id, d.content AS content,
              d.previousValue AS pv, d.previousSha AS ps, d.previousKind AS pk, d.previousSource AS psrc ORDER BY d.order`, { s: `${P}loc` })
    expect(rows[0]).toMatchObject({ order: 1, content: BLOCKS('Ny.'), pv: old, ps: sha, pk: 'description', psrc: `proposal:bundle:${P}c:t` })
    expect(rows[1]).toMatchObject({ order: 2, id: `desc:Location:${P}loc:2`, content: BLOCKS('To.') })
    expect(rows[1].pv ?? null).toBeNull()                                                                       // a new text has nothing before it
  })

  it('a Source is keyed by id: created, changed, linked and deleted by it', async () => {
    await apply(`Unit:${P}su`, [{ op: 'create-entity', kind: 'Unit', slug: `${P}su`, props: {} }], SYNC)
    await apply(`Source:${P}src`, [{ op: 'create-entity', kind: 'Source', slug: `${P}src`, props: { title: 'Rapport' },
      edges: [{ type: 'REFERENCED_IN', to: `Unit:${P}su` }] }], SYNC)
    const created = await props('Source', 'id', `${P}src`)
    expect(created).toMatchObject({ id: `${P}src`, title: 'Rapport' })
    expect(created).not.toHaveProperty('slug')
    const edge = await runCypher<{ n: number }>(env, `MATCH (:Source {id: $i})-[r:REFERENCED_IN]->(:Unit {slug: $u}) RETURN count(r) AS n`, { i: `${P}src`, u: `${P}su` })
    expect(Number(edge[0].n)).toBe(1)

    await apply(`Source:${P}src`, [{ op: 'set-props', props: { title: { from: 'Rapport', to: 'Rapport 2' } } }], SYNC)
    expect(await props('Source', 'id', `${P}src`)).toMatchObject({ title: 'Rapport 2' })
    await apply(`Source:${P}src`, [{ op: 'delete-entity' }], SYNC)
    expect(await props('Source', 'id', `${P}src`)).toBeNull()
  })

  it('an outline: the archive records what was absorbed, and a changed text makes it stale with what it produced marked older', async () => {
    const slug = `${P}outline-b`
    await runCypher(env, `CREATE (o:Outline {slug: $s, canonicalName: 'Testoutline'}) CREATE (o)-[:HAS_CONTENT]->(:Description {id: $d, order: 1, content: $c})`,
      { s: slug, d: `desc:Outline:${slug}:1`, c: BLOCKS('Versjon en.') })

    const first = (await readOutlineVersion(env, slug))!
    expect(first).toMatchObject({ slug, state: 'new', absorbedSha: null, archivedAt: null })
    expect(first.contentSha).toBe(await outlineContentSha([{ order: 1, content: BLOCKS('Versjon en.') }]))

    // A bundle made from this version is accepted: it creates something, and the outline is archived.
    await apply(`Operation:${P}prod`, [{ op: 'create-entity', kind: 'Operation', slug: `${P}prod`, props: {} }], outline(first.contentSha, slug), `bundle:${P}d:t`)
    await apply(`Outline:${slug}`, [{ op: 'obsolete-outline', reason: 'fully absorbed' }], outline(first.contentSha, slug), `bundle:${P}d:t`)

    const absorbed = (await readOutlineVersion(env, slug))!
    expect(absorbed).toMatchObject({ state: 'absorbed', absorbedSha: first.contentSha, absorbedBundle: `bundle:${P}d:t`, archivedAt: AT })
    expect((await readProduced(env, slug, absorbed.contentSha)).entities).toEqual([
      { ref: `Operation:${P}prod`, originBundle: `bundle:${P}d:t`, originSha: first.contentSha, olderVersion: false },
    ])

    // The text changes.
    await runCypher(env, `MATCH (:Outline {slug: $s})-[:HAS_CONTENT]->(d:Description) SET d.content = $c`, { s: slug, c: BLOCKS('Versjon to.') })
    const stale = (await readOutlineVersion(env, slug))!
    expect(stale).toMatchObject({ state: 'stale', absorbedSha: first.contentSha })
    expect(stale.contentSha).not.toBe(first.contentSha)
    expect((await readProduced(env, slug, stale.contentSha)).entities.map(e => [e.ref, e.olderVersion])).toEqual([[`Operation:${P}prod`, true]])
  })

  it('the archive statement is valid on its own (accept.ts and accept-all.ts run it as it is)', async () => {
    const slug = `${P}outline-c`
    await runCypher(env, `CREATE (:Outline {slug: $s})`, { s: slug })
    const s = archiveOutlineStatement({ slug, at: AT, reason: 'r', sha: 'abc', bundleId: `bundle:${P}e:t` })
    await runCypher(env, s.statement, s.parameters)
    expect(await props('Outline', 'slug', slug)).toMatchObject({ archivedAt: AT, archivedReason: 'r', absorbedSha: 'abc', absorbedBundle: `bundle:${P}e:t` })
  })
})
