/**
 * PATCH /api/admin/event/:slug/transport — replace the set of Transport
 * (aircraft, vessels) used in this Operation or Incident.
 *
 * Body: { transport: [{ transportSlug }] }
 *
 *   (Operation|Incident)-[:USED]->(Transport)
 *
 * Edges to Transport that stay in the list are kept as they are (their
 * `role` and `sourceRef` survive); the rest are removed. USED edges to
 * EquipmentType are not touched.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

interface TransportInput { transportSlug: string }
interface Body { transport?: TransportInput[] }

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const slug = String(params.slug)
  const body = await request.json<Body>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)
  const transport = body.transport
  if (!Array.isArray(transport)) return json({ error: 'transport must be an array' }, 400)

  for (const t of transport) {
    if (typeof t.transportSlug !== 'string' || !t.transportSlug) {
      return json({ error: 'Bad transportSlug' }, 400)
    }
  }
  const slugs = transport.map(t => t.transportSlug)

  try {
    await runCypher(env, `
      MATCH (e:Operation|Incident {slug: $slug})-[r:USED]->(t:Transport)
      WHERE NOT t.slug IN $slugs
      DELETE r
    `, { slug, slugs })

    if (slugs.length) {
      await runCypher(env, `
        MATCH (e:Operation|Incident {slug: $slug})
        UNWIND $slugs AS tSlug
        OPTIONAL MATCH (t:Transport {slug: tSlug})
        FOREACH (_ IN CASE WHEN t IS NOT NULL THEN [1] ELSE [] END |
          MERGE (e)-[:USED]->(t)
        )
      `, { slug, slugs })
    }
    return json({ ok: true, count: slugs.length })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
