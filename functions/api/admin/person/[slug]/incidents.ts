/**
 * PATCH /api/admin/person/:slug/incidents — replace INVOLVED_IN edges.
 *
 * Body: { incidents: [{ incidentSlug }] }
 *
 *   (Person)-[:INVOLVED_IN]->(Incident)
 *
 * The edge carries no metadata; the Incident itself owns date + attribution.
 * Per-person descriptions live on HAS_INCIDENT_NOTE → Description.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import type { Neo4jEnv } from '~/_lib/neo4j.ts'
import { saveEdgeSet } from '~/_lib/edge-set.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

interface IncidentInput {
  incidentSlug: string
}

interface Body {
  incidents?: IncidentInput[]
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const slug = String(params.slug)
  const body = await request.json<Body>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)
  const incidents = body.incidents
  if (!Array.isArray(incidents)) return json({ error: 'incidents must be an array' }, 400)

  for (const i of incidents) {
    if (typeof i.incidentSlug !== 'string' || !i.incidentSlug) {
      return json({ error: 'Bad incidentSlug' }, 400)
    }
  }

  try {
    await saveEdgeSet(env, {
      anchor: { label: 'Person', slug }, rel: 'INVOLVED_IN', direction: 'out', targetLabel: 'Incident',
      items: incidents.map(i => ({ slug: i.incidentSlug })),
    })

    return json({ ok: true, count: incidents.length })
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
