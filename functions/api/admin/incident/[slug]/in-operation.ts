/**
 * PATCH /api/admin/incident/:slug/in-operation — set or clear the parent
 * Operation that contains this Incident.
 *
 * Body: { operationSlug: string | null }
 *
 *   (Operation)-[:RELATED_TO {kind:'contains'}]->(Incident)
 *
 * An Incident can sit inside at most one Operation; we replace the edge
 * unconditionally.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

interface Body { operationSlug?: string | null }

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const slug = String(params.slug)
  const body = await request.json<Body>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)

  const opSlug = body.operationSlug
  if (opSlug !== null && (typeof opSlug !== 'string' || !opSlug)) {
    return json({ error: 'operationSlug must be a non-empty string or null' }, 400)
  }

  try {
    await runCypher(env, `
      MATCH (:Operation)-[r:RELATED_TO {kind:'contains'}]->(i:Incident {slug: $slug}) DELETE r
    `, { slug })

    if (opSlug) {
      await runCypher(env, `
        MATCH (i:Incident {slug: $slug})
        OPTIONAL MATCH (op:Operation {slug: $opSlug})
        FOREACH (_ IN CASE WHEN op IS NOT NULL THEN [1] ELSE [] END |
          MERGE (op)-[r:RELATED_TO]->(i)
          ON CREATE SET r.kind = 'contains'
          ON MATCH  SET r.kind = 'contains'
        )
      `, { slug, opSlug })
    }
    return json({ ok: true, operationSlug: opSlug ?? null })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
