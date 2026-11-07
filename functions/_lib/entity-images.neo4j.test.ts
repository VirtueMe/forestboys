/**
 * An entity's own photos against the local Neo4j (#414). Opt in with `npm run test:neo4j`.
 *
 * Safe by construction: localhost only, every node has an id or slug starting `zz-test-`, and everything made is removed
 * afterwards (and what a crashed run left, first).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCypher, type Neo4jEnv } from './neo4j.ts'
import {
  addImageQuery, entityExistsQuery, labelExpr, listImagesQuery, removeImageQuery, setCaptionsQuery, setHeroQuery, setOrderQuery,
} from './entity-images.ts'

const E = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env
const ENABLED = E.NEO4J_TEST === '1'
const P = `zz-test-${Math.random().toString(36).slice(2, 8)}-`

const env = {
  NEO4J_URI: E.NEO4J_URI ?? '', NEO4J_HTTP_URI: E.NEO4J_HTTP_URI,
  NEO4J_USERNAME: E.NEO4J_USERNAME ?? '', NEO4J_PASSWORD: E.NEO4J_PASSWORD ?? '',
} as Neo4jEnv
const run = (cypher: string, params: Record<string, unknown> = {}) => runCypher<Record<string, unknown>>(env, cypher, params)
const cleanup = async () => { await run(`MATCH (n) WHERE n.id STARTS WITH 'zz-test-' OR n.slug STARTS WITH 'zz-test-' DETACH DELETE n`) }
const n = (v: unknown) => Number(v)

const slug = `${P}ola`, other = `${P}kari`
const add = (label: string, s: string, id: string, extra: Record<string, unknown> = {}) =>
  run(addImageQuery(labelExpr(label)), { slug: s, sourceId: `${P}${id}`, url: `/images/${id}`, license: null, attribution: null, caption: null, ...extra })
const list = async (label = 'Person', s = slug) =>
  (await run(listImagesQuery(labelExpr(label)), { slug: s })).map(r => ({ id: String(r.id).slice(P.length), caption: r.caption, isHero: r.isHero, order: n(r.order) }))

describe.skipIf(!ENABLED)('entity photo queries, against the local Neo4j', () => {
  beforeAll(async () => {
    const host = env.NEO4J_URI.replace(/^[a-z0-9+.-]+:\/\//, '').replace(/[:/].*$/, '')
    if (!/^(localhost|127\.0\.0\.1|::1)$/.test(host)) throw new Error(`NEO4J_URI points at ${host}: this test only runs against localhost`)
    await cleanup()
    await run(`CREATE (:Person {slug: $a}), (:Person {slug: $b}), (:Station {slug: $a})
               CREATE (:Unit {slug: $p + 'u'})-[:HAS_IMAGE {order: 1}]->(:Source {id: $p + 'inherited', url: '/images/inh'})`,
      { a: slug, b: other, p: P })
  })
  afterAll(cleanup)

  it('knows whether the entity exists, by label', async () => {
    expect(await run(entityExistsQuery(labelExpr('Person')), { slug })).toHaveLength(1)
    expect(await run(entityExistsQuery(labelExpr('Unit')), { slug })).toHaveLength(0)
    expect(await run(entityExistsQuery(labelExpr('Person')), { slug: `${P}nobody` })).toHaveLength(0)
  })

  it('adds photos in order; the first is the hero; a repeat changes nothing', async () => {
    await add('Person', slug, 'a', { caption: 'First', license: 'CC-BY-4.0', attribution: 'Jan' })
    await add('Person', slug, 'b')
    await add('Person', slug, 'b')
    expect(await list()).toEqual([
      { id: 'a', caption: 'First', isHero: true, order: 1 },
      { id: 'b', caption: null, isHero: false, order: 2 },
    ])
    const [src] = await run(`MATCH (s:Source {id: $id}) RETURN s.kind AS kind, s.license AS license, s.attribution AS attribution`, { id: `${P}a` })
    expect(src).toEqual({ kind: 'photograph', license: 'CC-BY-4.0', attribution: 'Jan' })
  })

  it('keeps the photos of two entities apart, and the same photo can hang on both', async () => {
    await add('Person', other, 'a')
    expect(await list('Person', other)).toEqual([{ id: 'a', caption: null, isHero: true, order: 1 }])
    expect((await list()).map(i => i.id)).toEqual(['a', 'b'])
    expect(await run(`MATCH (s:Source {id: $id}) RETURN s`, { id: `${P}a` })).toHaveLength(1)   // one Source, two edges
  })

  it('does not list a photo an entity only inherits from another', async () => {
    expect((await list()).map(i => i.id)).not.toContain('inherited')
  })

  it('reorders, and a photo with a caption keeps it', async () => {
    await add('Person', slug, 'c')
    await run(setOrderQuery(labelExpr('Person')), { slug, ids: [`${P}c`, `${P}a`, `${P}b`] })
    expect((await list()).map(i => [i.id, i.order])).toEqual([['c', 1], ['a', 2], ['b', 3]])
    expect((await list())[1].caption).toBe('First')
  })

  it('sets and clears captions', async () => {
    await run(setCaptionsQuery(labelExpr('Person')), { slug, caps: [[`${P}b`, 'Second'], [`${P}a`, null]] })
    expect((await list()).map(i => [i.id, i.caption])).toEqual([['c', null], ['a', null], ['b', 'Second']])
  })

  it('moves the hero so that exactly one remains, and clears it with null', async () => {
    await run(setHeroQuery(labelExpr('Person')), { slug, hero: `${P}b` })
    expect((await list()).filter(i => i.isHero).map(i => i.id)).toEqual(['b'])
    await run(setHeroQuery(labelExpr('Person')), { slug, hero: null })
    expect((await list()).some(i => i.isHero)).toBe(false)
    expect((await list('Person', other))[0].isHero).toBe(true)   // another entity's hero is not touched
  })

  it('removes the edge only: the Source stays, and the other entity keeps its edge', async () => {
    expect(await run(removeImageQuery(labelExpr('Person')), { slug, id: `${P}a` })).toHaveLength(1)
    expect((await list()).map(i => i.id)).toEqual(['c', 'b'])
    expect(await run(`MATCH (s:Source {id: $id}) RETURN s`, { id: `${P}a` })).toHaveLength(1)
    expect(await list('Person', other)).toHaveLength(1)
    expect(await run(removeImageQuery(labelExpr('Person')), { slug, id: `${P}a` })).toHaveLength(0)   // already gone
  })

  it('a label scopes the match: a Station with the same slug is another entity', async () => {
    expect(await list('Station')).toEqual([])
    await add('Station', slug, 's1')
    expect((await list('Station')).map(i => i.id)).toEqual(['s1'])
    expect((await list()).map(i => i.id)).toEqual(['c', 'b'])
  })

  it('takes an Operation or an Incident as one kind (the event pages)', async () => {
    await run(`CREATE (:Operation {slug: $p + 'op'}), (:Incident {slug: $p + 'inc'})`, { p: P })
    const both = labelExpr('Operation', 'Incident')
    for (const s of ['op', 'inc']) {
      expect(await run(entityExistsQuery(both), { slug: `${P}${s}` })).toHaveLength(1)
      await run(addImageQuery(both), { slug: `${P}${s}`, sourceId: `${P}e-${s}`, url: '/images/e', license: null, attribution: null, caption: null })
      expect(await run(listImagesQuery(both), { slug: `${P}${s}` })).toHaveLength(1)
    }
    expect(await run(entityExistsQuery(both), { slug })).toHaveLength(0)   // a Person is neither
  })
})
