/**
 * PATCH /api/admin/person/:slug/rank — set the rank the person is known by
 * (docs/PERSON-RANKS.md R1): exactly one `(Person)-[:RANK]->(Rank)`.
 *
 * Body: { rankSlug }
 *
 * An editor save is `verified` with sourceRef 'admin-edit'; the Sanity sync
 * only updates a RANK whose sourceRef is still the migration's, so this
 * takes precedence over later name changes in Sanity (they go to review).
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const slug = String(params.slug)
  const body = await request.json<{ rankSlug?: unknown }>().catch(() => null)
  if (!body || typeof body.rankSlug !== 'string' || !body.rankSlug) return json({ error: 'Bad rankSlug' }, 400)

  try {
    const rows = await runCypher<{ ok: boolean }>(env, `
      MATCH (p:Person {slug: $slug})
      MATCH (rk:Rank {slug: $rankSlug})
      OPTIONAL MATCH (p)-[old:RANK]->()
      DELETE old
      WITH DISTINCT p, rk
      CREATE (p)-[:RANK {state: 'verified', sourceRef: 'admin-edit'}]->(rk)
      RETURN true AS ok
    `, { slug, rankSlug: body.rankSlug })
    if (!rows.length) return json({ error: `Finnes ikke: person ${slug} eller grad ${body.rankSlug}` }, 404)
    return json({ ok: true })
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
