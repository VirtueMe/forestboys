/**
 * PATCH /api/admin/person/:slug/ranks — replace the person's HELD_RANK edges.
 *
 * Body: { ranks: [{ rankSlug: string, from?: number | null, to?: number | null }, ...] }
 *
 * - Deletes every existing HELD_RANK edge on the Person, then creates one
 *   per entry. Admin-entered ranks default to state="verified".
 * - Unknown rankSlug silently skips (OPTIONAL MATCH), so stale references
 *   never create phantom Rank nodes.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

interface RankInput {
  rankSlug: string
  from?:    number | null
  to?:      number | null
}

interface Body {
  ranks?: RankInput[]
}

function isYearOrNull(v: unknown): v is number | null {
  return v === null || v === undefined ||
         (typeof v === 'number' && Number.isInteger(v) && v >= 1800 && v <= 2100)
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const slug = String(params.slug)
  const body = await request.json<Body>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)
  const ranks = body.ranks
  if (!Array.isArray(ranks)) return json({ error: 'ranks must be an array' }, 400)

  for (const r of ranks) {
    if (typeof r.rankSlug !== 'string' || !r.rankSlug)   return json({ error: 'Bad rankSlug' }, 400)
    if (!isYearOrNull(r.from))                           return json({ error: `Bad from: ${String(r.from)}` }, 400)
    if (!isYearOrNull(r.to))                             return json({ error: `Bad to: ${String(r.to)}` }, 400)
  }

  try {
    // Wipe existing edges first so the replace-all is clean.
    await runCypher(env, `
      MATCH (p:Person {slug: $slug})-[h:HELD_RANK]->()
      DELETE h
    `, { slug })

    if (ranks.length) {
      await runCypher(env, `
        MATCH (p:Person {slug: $slug})
        UNWIND $ranks AS r
        OPTIONAL MATCH (rank:Rank {slug: r.rankSlug})
        FOREACH (_ IN CASE WHEN rank IS NOT NULL THEN [1] ELSE [] END |
          CREATE (p)-[:HELD_RANK { state: "verified", from: r.from, to: r.to }]->(rank)
        )
      `, { slug, ranks: ranks.map(r => ({ rankSlug: r.rankSlug, from: r.from ?? null, to: r.to ?? null })) })
    }

    return json({ ok: true, count: ranks.length })
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
