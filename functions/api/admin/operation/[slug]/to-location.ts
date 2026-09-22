/**
 * PATCH /api/admin/operation/:slug/to-location — set or clear the
 * single Location an Operation is heading toward.
 *
 * Body: { locationSlug: string | null }
 *
 *   (Operation)-[:TO]->(Location)
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'

interface Env extends Neo4jEnv { SESSION_SECRET: string }
interface Body { locationSlug?: string | null }

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const slug = String(params.slug)
  const body = await request.json<Body>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)

  const target = body.locationSlug
  if (target !== null && (typeof target !== 'string' || !target)) {
    return json({ error: 'locationSlug must be a non-empty string or null' }, 400)
  }

  try {
    await runCypher(env, `
      MATCH (op:Operation {slug: $slug})-[r:TO]->(:Location) DELETE r
    `, { slug })
    if (target) {
      await runCypher(env, `
        MATCH (op:Operation {slug: $slug})
        OPTIONAL MATCH (l:Location {slug: $target})
        FOREACH (_ IN CASE WHEN l IS NOT NULL THEN [1] ELSE [] END |
          MERGE (op)-[:TO]->(l)
        )
      `, { slug, target })
    }
    return json({ ok: true, locationSlug: target ?? null })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
