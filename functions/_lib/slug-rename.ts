/**
 * Renaming a page's slug (#96): one helper for every place that does it.
 *
 * In one transaction it sets the new slug, keeps the old one as a `SlugAlias` (functions/_lib/slug-alias.ts), makes the
 * entity's own description ids follow the slug (`desc:<kind>:<slug>:<order>`), and rewrites the links in descriptions
 * that pointed at the old slug (src/utils/linkCheck.ts). `planRename` reads and says what would change, without
 * writing: the editor shows it before the rename is confirmed.
 *
 * A description that changes between the read and the write is left as it is (its content no longer matches); it
 * still works, since the old slug leads to the page through the alias.
 */

import { runCypher, runCypherTx, type Neo4jEnv, type CypherStatement } from './neo4j.ts'
import { SLUG_RE, routeOf, slugClaim } from './slug-alias.ts'
import { linkTargets, rewriteLink } from '../../src/utils/linkCheck.ts'

export interface RenameRequest { label: string; from: string; to: string }

export interface RenamePlan {
  label: string
  route: string
  from:  string
  to:    string
  /** Descriptions with a link to rewrite. */
  rewrites: { eid: string; before: string; after: string; links: number }[]
  /** The new slug is a former slug of this entity: the alias is dropped instead of kept. */
  restoresAlias: boolean
  /** The entity's own descriptions whose id follows the slug. */
  ownDescriptions: number
}

export interface RenameFailure { error: string; status: number }

export interface RenameResult extends Pick<RenamePlan, 'label' | 'from' | 'to'> {
  ok: true
  /** Descriptions and links rewritten. */
  descriptions: number
  links:        number
  /** Descriptions that changed between the read and the write and were left alone. */
  skipped:      number
}

const lbl = (l: string) => `\`${l}\``

export async function planRename(env: Neo4jEnv, req: RenameRequest): Promise<RenamePlan | RenameFailure> {
  const { label, from, to } = req
  const route = routeOf(label)
  if (!route) return { error: `${label} has no page of its own: its slug cannot be renamed`, status: 400 }
  if (!SLUG_RE.test(to)) return { error: 'slug må være små bokstaver, tall og bindestrek', status: 400 }
  if (to === 'new') return { error: 'slug "new" er reservert', status: 400 }
  if (to === from) return { error: 'Slug is unchanged', status: 400 }

  const [found] = await runCypher<{ c: number }>(env, `MATCH (n:${lbl(label)} {slug: $from}) RETURN count(n) AS c`, { from }, 'Read')
  if (Number(found?.c ?? 0) === 0) return { error: `${label} ${from} not found`, status: 404 }

  const claim = await slugClaim(env, route, to, from)
  if (claim === 'live') return { error: `Slug finnes allerede: ${to}`, status: 409 }
  if (claim === 'alias') return { error: `Slug er et gammelt navn på en annen side: ${to}`, status: 409 }

  const [back] = await runCypher<{ c: number }>(env, `
    MATCH (:SlugAlias {route: $route, slug: $to})-[:ALIAS_OF]->(n:${lbl(label)} {slug: $from}) RETURN count(*) AS c`, { route, to, from }, 'Read')
  const [own] = await runCypher<{ c: number }>(env, `
    MATCH (:${lbl(label)} {slug: $from})-[:HAS_CONTENT]->(d:Description) WHERE d.id CONTAINS $seg RETURN count(d) AS c`, { from, seg: `:${from}:` }, 'Read')

  const rows = await runCypher<{ eid: string; content: string }>(env, `
    MATCH (d:Description) WHERE d.content CONTAINS $from RETURN elementId(d) AS eid, d.content AS content`, { from }, 'Read')

  const target = { path: route + encodeURIComponent(to), label, slug: to }
  const rewrites: RenamePlan['rewrites'] = []
  for (const r of rows) {
    if (typeof r.content !== 'string') continue
    const hits = linkTargets(r.content).filter(t => t.route === route && t.slug === from)
    if (!hits.length) continue
    let after = r.content
    for (const h of new Map(hits.map(x => [`${x.source}\n${x.stored}`, x])).values()) after = rewriteLink(after, h, target)
    if (after !== r.content) rewrites.push({ eid: r.eid, before: r.content, after, links: hits.length })
  }
  return { label, route, from, to, rewrites, restoresAlias: Number(back?.c ?? 0) > 0, ownDescriptions: Number(own?.c ?? 0) }
}

export async function renameSlug(env: Neo4jEnv, req: RenameRequest, at = new Date().toISOString()): Promise<RenameResult | RenameFailure> {
  const plan = await planRename(env, req)
  if ('error' in plan) return plan
  const { label, route, from, to } = plan

  const stmts: CypherStatement[] = [
    { statement: `MATCH (n:${lbl(label)} {slug: $from}) SET n.slug = $to
                  WITH n OPTIONAL MATCH (back:SlugAlias {route: $route, slug: $to})-[:ALIAS_OF]->(n) DETACH DELETE back`,
      parameters: { from, to, route } },
    { statement: `MATCH (n:${lbl(label)} {slug: $to})
                  MERGE (a:SlugAlias {route: $route, slug: $from}) ON CREATE SET a.kind = $label, a.createdAt = $at
                  MERGE (a)-[:ALIAS_OF]->(n)`,
      parameters: { from, to, route, label, at } },
    { statement: `MATCH (:${lbl(label)} {slug: $to})-[:HAS_CONTENT]->(d:Description) WHERE d.id CONTAINS $fromSeg
                  SET d.id = replace(d.id, $fromSeg, $toSeg)`,
      parameters: { to, fromSeg: `:${from}:`, toSeg: `:${to}:` } },
    ...plan.rewrites.map(r => ({
      statement: `MATCH (d:Description) WHERE elementId(d) = $eid AND d.content = $before SET d.content = $after RETURN count(d) AS n`,
      parameters: { eid: r.eid, before: r.before, after: r.after },
    })),
  ]
  const out = await runCypherTx(env, stmts)
  const done = out.slice(3).map((rows, i) => (Number(rows[0]?.n ?? 0) === 1 ? plan.rewrites[i] : null))
  const applied = done.filter((r): r is RenamePlan['rewrites'][number] => r !== null)
  return { ok: true, label, from, to, descriptions: applied.length, links: applied.reduce((n, r) => n + r.links, 0), skipped: plan.rewrites.length - applied.length }
}
