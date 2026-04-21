/**
 * PATCH /api/admin/operation/:slug/incidents — replace the set of
 * Incidents that OCCURRED_IN this Operation.
 *
 * Body: { incidents: [{ incidentSlug }] }
 *
 *   (Incident)-[:OCCURRED_IN]->(Operation)
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

interface IncidentInput { incidentSlug: string }
interface Body { incidents?: IncidentInput[] }

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const slug = String(params.slug)
  const body = await request.json<Body>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)
  const incidents = body.incidents
  if (!Array.isArray(incidents)) return json({ error: 'incidents must be an array' }, 400)

  for (const i of incidents) {
    if (typeof i.incidentSlug !== 'string' || !i.incidentSlug) return json({ error: 'Bad incidentSlug' }, 400)
  }

  try {
    await runCypher(env, `
      MATCH (:Incident)-[r:OCCURRED_IN]->(op:Operation {slug: $slug}) DELETE r
    `, { slug })

    if (incidents.length) {
      await runCypher(env, `
        MATCH (op:Operation {slug: $slug})
        UNWIND $items AS x
        OPTIONAL MATCH (i:Incident {slug: x.incidentSlug})
        FOREACH (_ IN CASE WHEN i IS NOT NULL THEN [1] ELSE [] END |
          CREATE (i)-[:OCCURRED_IN]->(op)
        )
      `, { slug, items: incidents.map(i => ({ incidentSlug: i.incidentSlug })) })
    }
    return json({ ok: true, count: incidents.length })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
