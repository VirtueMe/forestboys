/**
 * PATCH /api/admin/organization/:slug/incidents — replace the set of
 * Incidents ORCHESTRATED_BY this Organization. Mirror of /operations.
 *
 * Body: { incidents: [{ incidentSlug }, ...] }
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

interface Body {
  incidents?: { incidentSlug: string }[]
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const slug = String(params.slug)
  const body = await request.json<Body>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)
  if (!Array.isArray(body.incidents)) return json({ error: 'incidents must be an array' }, 400)
  for (const i of body.incidents) {
    if (typeof i.incidentSlug !== 'string' || !i.incidentSlug) {
      return json({ error: 'Bad incidentSlug' }, 400)
    }
  }

  const keepSlugs = body.incidents.map(i => i.incidentSlug)

  try {
    await runCypher(env, `
      MATCH (i:Incident)-[r:ORCHESTRATED_BY]->(o:Organization {slug: $slug})
      WHERE NOT i.slug IN $keepSlugs
      DELETE r
    `, { slug, keepSlugs })

    if (keepSlugs.length) {
      await runCypher(env, `
        MATCH (o:Organization {slug: $slug})
        UNWIND $keepSlugs AS incSlug
        MATCH (i:Incident {slug: incSlug})
        MERGE (i)-[:ORCHESTRATED_BY]->(o)
      `, { slug, keepSlugs })
    }

    return json({ ok: true, count: keepSlugs.length })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
