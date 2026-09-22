/**
 * PATCH /api/admin/operation/:slug/from-station — set or clear the
 * single Station an Operation departs from (typically an airfield or
 * naval base).
 *
 * Body: { stationSlug: string | null }
 *
 *   (Operation)-[:FROM_STATION]->(Station)
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'

interface Env extends Neo4jEnv { SESSION_SECRET: string }
interface Body { stationSlug?: string | null }

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const slug = String(params.slug)
  const body = await request.json<Body>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)

  const target = body.stationSlug
  if (target !== null && (typeof target !== 'string' || !target)) {
    return json({ error: 'stationSlug must be a non-empty string or null' }, 400)
  }

  try {
    await runCypher(env, `
      MATCH (op:Operation {slug: $slug})-[r:FROM_STATION]->(:Station) DELETE r
    `, { slug })
    if (target) {
      await runCypher(env, `
        MATCH (op:Operation {slug: $slug})
        OPTIONAL MATCH (s:Station {slug: $target})
        FOREACH (_ IN CASE WHEN s IS NOT NULL THEN [1] ELSE [] END |
          MERGE (op)-[:FROM_STATION]->(s)
        )
      `, { slug, target })
    }
    return json({ ok: true, stationSlug: target ?? null })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
