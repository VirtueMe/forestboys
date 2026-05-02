/**
 * PATCH /api/admin/incident/:slug/sub-incidents — replace the set of child
 * Incidents contained by this Incident.
 *
 * Body: { children: [{ incidentSlug }] }
 *
 *   (parent:Incident)-[:RELATED_TO {kind:'contains'}]->(child:Incident)
 *
 * Refuses self-reference.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

interface ChildInput { incidentSlug: string }
interface Body { children?: ChildInput[] }

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const slug = String(params.slug)
  const body = await request.json<Body>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)
  const children = body.children
  if (!Array.isArray(children)) return json({ error: 'children must be an array' }, 400)

  for (const c of children) {
    if (typeof c.incidentSlug !== 'string' || !c.incidentSlug) return json({ error: 'Bad incidentSlug' }, 400)
    if (c.incidentSlug === slug) return json({ error: 'An Incident cannot be its own child' }, 400)
  }

  try {
    await runCypher(env, `
      MATCH (parent:Incident {slug: $slug})-[r:RELATED_TO {kind:'contains'}]->(:Incident) DELETE r
    `, { slug })

    if (children.length) {
      await runCypher(env, `
        MATCH (parent:Incident {slug: $slug})
        UNWIND $items AS x
        OPTIONAL MATCH (child:Incident {slug: x.incidentSlug})
        FOREACH (_ IN CASE WHEN child IS NOT NULL THEN [1] ELSE [] END |
          MERGE (parent)-[r:RELATED_TO]->(child)
          ON CREATE SET r.kind = 'contains'
          ON MATCH  SET r.kind = 'contains'
        )
      `, { slug, items: children.map(c => ({ incidentSlug: c.incidentSlug })) })
    }
    return json({ ok: true, count: children.length })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
