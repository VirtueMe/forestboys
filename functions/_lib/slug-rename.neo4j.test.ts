/**
 * Slug rename against a real Neo4j (the local one): the statements are valid Cypher and do what they claim (#96).
 * Opt in with `npm run test:neo4j`. Like the apply tests, it refuses anything but localhost and touches only nodes whose
 * slug or id starts with `zz-test-`; everything it made is removed afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCypher, type Neo4jEnv } from './neo4j.ts'
import { findAlias, slugClaim, PERSON_RENAME_ALIASES, DROP_DANGLING_ALIASES, dropShadowedAliases } from './slug-alias.ts'
import { planRename, renameSlug } from './slug-rename.ts'
import { buildSitemap } from './sitemap.ts'
import { resolveSlug } from '../../src/utils/slugResolver.ts'
import { aliasRedirect } from '../../src/utils/aliasRedirect.ts'

const E = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env
const ENABLED = E.NEO4J_TEST === '1'

const env = {
  NEO4J_URI: E.NEO4J_URI ?? '', NEO4J_HTTP_URI: E.NEO4J_HTTP_URI,
  NEO4J_USERNAME: E.NEO4J_USERNAME ?? '', NEO4J_PASSWORD: E.NEO4J_PASSWORD ?? '',
} as Neo4jEnv

const RUN = Math.random().toString(36).slice(2, 8)
const P = `zz-test-${RUN}-`
const AT = '2026-10-11T12:00:00.000Z'

/** A description with one link to `href` (a `link` mark) and one person mark to `person`. */
const withLinks = (href: string, person?: string) => JSON.stringify([{
  _type: 'block', _key: 'b1',
  markDefs: [{ _key: 'l1', _type: 'link', href }, ...(person ? [{ _key: 'p1', _type: 'person', slug: person }] : [])],
  children: [{ _type: 'span', _key: 's1', text: 'se her', marks: ['l1'] }, ...(person ? [{ _type: 'span', _key: 's2', text: ' og ham', marks: ['p1'] }] : [])],
}])

const count = async (cypher: string, params: Record<string, unknown> = {}) => Number((await runCypher<{ n: number }>(env, cypher, params))[0].n)

async function cleanup() {
  await runCypher(env, `MATCH (n) WHERE n.slug STARTS WITH 'zz-test-' OR n.id STARTS WITH 'zz-test-' OR n.id CONTAINS ':zz-test-' DETACH DELETE n`, {})
}

describe.skipIf(!ENABLED)('slug rename, against the local Neo4j', () => {
  beforeAll(async () => {
    const host = env.NEO4J_URI.replace(/^[a-z0-9+.-]+:\/\//, '').replace(/[:/].*$/, '')
    if (!/^(localhost|127\.0\.0\.1|::1)$/.test(host)) throw new Error(`NEO4J_URI points at ${host}: this test only runs against localhost`)
    await cleanup()
  })
  afterAll(cleanup)

  const seed = async () => {
    await runCypher(env, `
      CREATE (a:Operation {slug: $a, canonicalName: 'Gammel'})-[:HAS_CONTENT]->(:Description {id: $da, order: 1, content: $ca})
      CREATE (b:Incident {slug: $b, canonicalName: 'Annen'})-[:HAS_CONTENT]->(:Description {id: $db, order: 1, content: $cb})
      CREATE (p:Person {slug: $p, canonicalName: 'Ham'})-[:HAS_CONTENT]->(:Description {id: $dp, order: 1, content: $cp})`,
      {
        a: `${P}old`, b: `${P}other`, p: `${P}ham`,
        da: `desc:Operation:${P}old:1`, db: `desc:Incident:${P}other:1`, dp: `desc:Person:${P}ham:1`,
        ca: withLinks(`/events/${P}other`),
        cb: withLinks(`/events/${P}old`, `${P}ham`),
        cp: withLinks(`/events/${P}old`),
      })
  }

  it('reads what a rename would change, and writes nothing', async () => {
    await seed()
    const plan = await planRename(env, { label: 'Operation', from: `${P}old`, to: `${P}new` })
    expect('error' in plan).toBe(false)
    if ('error' in plan) return
    expect(plan.route).toBe('/events/')
    expect(plan.rewrites).toHaveLength(2)                 // the incident's text and the person's text
    expect(plan.ownDescriptions).toBe(1)
    expect(plan.restoresAlias).toBe(false)
    expect(await count(`MATCH (n:Operation {slug: $s}) RETURN count(n) AS n`, { s: `${P}old` })).toBe(1)
    expect(await count(`MATCH (a:SlugAlias) WHERE a.slug STARTS WITH $p RETURN count(a) AS n`, { p: P })).toBe(0)
  })

  it('renames: new slug, an alias to the entity, the own description id and the links to it follow', async () => {
    const r = await renameSlug(env, { label: 'Operation', from: `${P}old`, to: `${P}new` }, AT)
    expect(r).toMatchObject({ ok: true, descriptions: 2, links: 2, skipped: 0 })

    expect(await count(`MATCH (n:Operation {slug: $s}) RETURN count(n) AS n`, { s: `${P}old` })).toBe(0)
    expect(await count(`MATCH (n:Operation {slug: $s}) RETURN count(n) AS n`, { s: `${P}new` })).toBe(1)
    expect(await count(`MATCH (:SlugAlias {route: '/events/', slug: $o, kind: 'Operation', createdAt: $at})-[:ALIAS_OF]->(:Operation {slug: $n}) RETURN count(*) AS n`,
      { o: `${P}old`, n: `${P}new`, at: AT })).toBe(1)
    expect(await count(`MATCH (:Operation {slug: $n})-[:HAS_CONTENT]->(d:Description {id: $id}) RETURN count(d) AS n`, { n: `${P}new`, id: `desc:Operation:${P}new:1` })).toBe(1)

    const hrefs = await runCypher<{ c: string }>(env, `MATCH (d:Description) WHERE d.id IN $ids RETURN d.content AS c`, { ids: [`desc:Incident:${P}other:1`, `desc:Person:${P}ham:1`] })
    expect(hrefs.map(h => h.c).join('')).toContain(`/events/${P}new`)
    expect(hrefs.map(h => h.c).join('')).not.toContain(`/events/${P}old`)
    // The link to a different page, and the person mark, are untouched.
    expect(hrefs.map(h => h.c).join('')).toContain(`"slug":"${P}ham"`)
    expect(await count(`MATCH (d:Description {id: $id}) WHERE d.content CONTAINS $h RETURN count(d) AS n`, { id: `desc:Operation:${P}new:1`, h: `/events/${P}other` })).toBe(1)
  })

  it('an old slug leads to the page, and is taken', async () => {
    expect(await findAlias(env, '/events/', `${P}old`)).toEqual({ label: 'Operation', slug: `${P}new` })
    expect(await findAlias(env, '/events/', `${P}nothing`)).toBeNull()
    expect(await findAlias(env, '/person/', `${P}old`)).toBeNull()           // another address space
    expect(await slugClaim(env, '/events/', `${P}old`)).toBe('alias')
    expect(await slugClaim(env, '/events/', `${P}new`)).toBe('live')
    expect(await slugClaim(env, '/events/', `${P}old`, `${P}new`)).toBeNull()  // the owner may take it back
    expect(await slugClaim(env, '/person/', `${P}old`)).toBeNull()

    const toOld = await renameSlug(env, { label: 'Incident', from: `${P}other`, to: `${P}old` })
    expect(toOld).toMatchObject({ status: 409 })
    const toLive = await renameSlug(env, { label: 'Incident', from: `${P}other`, to: `${P}new` })
    expect(toLive).toMatchObject({ status: 409 })
  })

  it('renames again: the aliases all point at the entity, none at another alias; taking a name back drops its alias', async () => {
    expect(await renameSlug(env, { label: 'Operation', from: `${P}new`, to: `${P}newer` }, AT)).toMatchObject({ ok: true })
    expect(await count(`MATCH (a:SlugAlias)-[:ALIAS_OF]->(:Operation {slug: $n}) WHERE a.slug IN $s RETURN count(a) AS n`, { n: `${P}newer`, s: [`${P}old`, `${P}new`] })).toBe(2)
    expect(await count(`MATCH (:SlugAlias)-[:ALIAS_OF]->(x:SlugAlias) RETURN count(x) AS n`)).toBe(0)

    const back = await planRename(env, { label: 'Operation', from: `${P}newer`, to: `${P}old` })
    expect(back).toMatchObject({ restoresAlias: true })
    expect(await renameSlug(env, { label: 'Operation', from: `${P}newer`, to: `${P}old` }, AT)).toMatchObject({ ok: true })
    expect(await findAlias(env, '/events/', `${P}old`)).toBeNull()                            // live again
    expect(await findAlias(env, '/events/', `${P}newer`)).toEqual({ label: 'Operation', slug: `${P}old` })
  })

  it('the person sync keeps old slugs as aliases; a slug another person takes over in the same run is theirs (#96)', async () => {
    // p1 was `a` and is now `c`; p2 was `b` and is now `a` (the freed slug reused); p3 was `d` and is now `e`, then gone.
    await runCypher(env, `
      CREATE (:Person {sanityId: $i1, slug: $c}), (:Person {sanityId: $i2, slug: $a}), (:Person {sanityId: $i3, slug: $e})`,
      { i1: `${P}sid1`, i2: `${P}sid2`, i3: `${P}sid3`, a: `${P}pa`, c: `${P}pc`, e: `${P}pe` })
    const renames = [{ id: `${P}sid1`, from: `${P}pa` }, { id: `${P}sid2`, from: `${P}pb` }, { id: `${P}sid3`, from: `${P}pd` }]
    await runCypher(env, PERSON_RENAME_ALIASES, { renames, at: AT })
    await runCypher(env, dropShadowedAliases('Person', '/person/'))
    expect(await findAlias(env, '/person/', `${P}pa`)).toBeNull()                              // live again, on p2
    expect(await findAlias(env, '/person/', `${P}pb`)).toEqual({ label: 'Person', slug: `${P}pa` })
    expect(await findAlias(env, '/person/', `${P}pd`)).toEqual({ label: 'Person', slug: `${P}pe` })

    await runCypher(env, `MATCH (p:Person {slug: $e}) DETACH DELETE p`, { e: `${P}pe` })
    await runCypher(env, DROP_DANGLING_ALIASES)
    expect(await count(`MATCH (a:SlugAlias {slug: $d}) RETURN count(a) AS n`, { d: `${P}pd` })).toBe(0)
    // Run twice: the same aliases, not more.
    await runCypher(env, PERSON_RENAME_ALIASES, { renames: renames.slice(0, 2), at: AT })
    await runCypher(env, PERSON_RENAME_ALIASES, { renames: renames.slice(0, 2), at: AT })
    expect(await count(`MATCH (a:SlugAlias {slug: $b})-[:ALIAS_OF]->() RETURN count(a) AS n`, { b: `${P}pb` })).toBe(1)
  })

  it('the resolver, the in-app redirect and the list all follow an old slug (#96)', async () => {
    // From the earlier tests: the Operation was renamed old → new → newer → old; `newer` and `new` are its aliases now.
    const read = (cypher: string, params?: Record<string, unknown>) => runCypher(env, cypher, params ?? {}, 'Read')
    expect(await resolveSlug(`${P}newer`, read)).toMatchObject({ path: `/events/${P}old`, slug: `${P}old` })
    expect(await aliasRedirect(`/events/${P}new/x`, read)).toBe(`/events/${P}old/x`)
    expect(await aliasRedirect(`/events/${P}old`, read)).toBeNull()                           // live: not an alias

    let stored = ''
    const kv = { put: (_k: string, v: string) => { stored = v; return Promise.resolve() } } as unknown as KVNamespace
    const sm = await buildSitemap({ ...env, SITEMAP: kv })
    expect(sm.aliases.get(`/events/${P}newer`)).toBe(`/events/${P}old`)
    expect(sm.known.has(`/events/${P}old`)).toBe(true)
    expect(sm.known.has(`/events/${P}newer`)).toBe(false)                                     // an alias is not a page
    expect(sm.paths.some(p => p.includes(P) && p.includes('newer'))).toBe(false)              // and not in sitemap.txt
    expect(stored).toContain(`/events/${P}newer\t/events/${P}old`)
  })

  it('refuses what cannot be renamed', async () => {
    expect(await renameSlug(env, { label: 'Operation', from: `${P}nothing`, to: `${P}x` })).toMatchObject({ status: 404 })
    expect(await renameSlug(env, { label: 'Operation', from: `${P}old`, to: 'Bad Slug' })).toMatchObject({ status: 400 })
    expect(await renameSlug(env, { label: 'Operation', from: `${P}old`, to: 'new' })).toMatchObject({ status: 400 })
    expect(await renameSlug(env, { label: 'Operation', from: `${P}old`, to: `${P}old` })).toMatchObject({ status: 400 })
    expect(await renameSlug(env, { label: 'Unit', from: `${P}old`, to: `${P}x` })).toMatchObject({ status: 400 })
  })
})
