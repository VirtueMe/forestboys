/**
 * PATCH /api/admin/person/:slug/ranks — replace the person's rank history
 * (docs/PERSON-RANKS.md R2): `(Person)-[:HELD_RANK {id, from, to, acting, state}]->(Rank)`.
 *
 * Body: { ranks: [{ id?, rankSlug, from?, to?, acting?, sourceRefs? }] }
 * Returns: { ok, ids } — entry ids in input order (new entries get fresh ids).
 *
 * - `from` / `to` are partial dates (YYYY, YYYY-MM, YYYY-MM-DD); empty `to`
 *   means open.
 * - Kept entries keep their id, so their notes (HAS_RANK_NOTE, keyed by
 *   rankEntryId) stay attached; notes of removed entries are deleted.
 * - `sourceRefs` — what proves the entry (a document, a page): SourceRef
 *   strings, checked against existing Sources (functions/_lib/source-refs.ts).
 *   The note's own citations are separate.
 * - Editor-entered entries are `verified`.
 * - The known rank (RANK) is separate — see ./rank.ts.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, runCypherTx, type Neo4jEnv } from '~/_lib/neo4j.ts'
import { periodError } from '~/_lib/period.ts'
import { RANK_NOTE, repointNoteStatements } from '~/_lib/edge-note.ts'
import { parseSourceRefs, unknownSources } from '~/_lib/source-refs.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

interface RankInput {
  id?:       unknown
  rankSlug?: unknown
  from?:     unknown
  to?:       unknown
  acting?:   unknown
  sourceRefs?: unknown
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const slug = String(params.slug)
  const body = await request.json<{ ranks?: RankInput[] }>().catch(() => null)
  if (!body || !Array.isArray(body.ranks)) return json({ error: 'ranks must be an array' }, 400)

  const refsPerEntry: string[][] = []
  for (const r of body.ranks) {
    if (typeof r.rankSlug !== 'string' || !r.rankSlug) return json({ error: 'Bad rankSlug' }, 400)
    const refs = parseSourceRefs(r.sourceRefs)
    if ('error' in refs) return json({ error: refs.error }, 400)
    refsPerEntry.push(refs.refs)
    const period = periodError(r.from, r.to)
    if (period) return json({ error: period }, 400)
    if (r.id !== undefined && r.id !== null && (typeof r.id !== 'string' || !r.id)) return json({ error: 'Ugyldig id' }, 400)
    if (r.acting !== undefined && r.acting !== null && typeof r.acting !== 'boolean') return json({ error: 'Bad acting' }, 400)
  }

  try {
    const known = await runCypher<{ ranks: string[]; ids: string[]; person: boolean }>(env, `
      OPTIONAL MATCH (p:Person {slug: $slug})
      OPTIONAL MATCH (p)-[h:HELD_RANK]->()
      WITH p, collect(h.id) AS ids
      OPTIONAL MATCH (rk:Rank) WHERE rk.slug IN $wanted
      RETURN p IS NOT NULL AS person, ids, collect(rk.slug) AS ranks
    `, { slug, wanted: body.ranks.map(r => r.rankSlug) })
    if (!known[0]?.person) return json({ error: `Finnes ikke: ${slug}` }, 404)
    const unknown = body.ranks.map(r => r.rankSlug as string).filter(s => !known[0].ranks.includes(s))
    if (unknown.length) return json({ error: `Ukjent grad: ${[...new Set(unknown)].join(', ')}` }, 400)
    const missingSources = await unknownSources(env, refsPerEntry.flat())
    if (missingSources.length) return json({ error: `Kilden finnes ikke: ${missingSources.join(', ')}` }, 400)

    // Keep ids this person already has; anything else gets a fresh one.
    const existing = new Set(known[0].ids.filter(Boolean))
    const items = body.ranks.map((r, i) => ({
      id:       typeof r.id === 'string' && existing.has(r.id) ? r.id : crypto.randomUUID(),
      rankSlug: r.rankSlug as string,
      from:     typeof r.from === 'string' ? r.from : null,
      to:       typeof r.to === 'string' ? r.to : null,
      acting:   r.acting === true,
      sourceRefs: refsPerEntry[i],
    }))
    const ids = items.map(i => i.id)
    const p = { slug, items, ids }

    await runCypherTx(env, [
      { statement: `MATCH (:Person {slug: $slug})-[h:HELD_RANK]->() DELETE h`, parameters: p },
      { statement: `
          MATCH (p:Person {slug: $slug})
          UNWIND $items AS r
          MATCH (rk:Rank {slug: r.rankSlug})
          CREATE (p)-[:HELD_RANK {id: r.id, from: r.from, to: r.to, acting: r.acting,
                                  sourceRefs: r.sourceRefs, state: 'verified'}]->(rk)`,
        parameters: p },
      // A kept entry may point at another rank now; its note follows.
      ...repointNoteStatements(RANK_NOTE).map(statement => ({ statement, parameters: p })),
      { statement: `
          MATCH (:Person {slug: $slug})-[:HAS_RANK_NOTE]->(d:Description)
          WHERE NOT d.rankEntryId IN $ids DETACH DELETE d`,
        parameters: p },
    ])
    return json({ ok: true, ids })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
