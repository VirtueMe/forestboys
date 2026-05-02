/**
 * PATCH /api/admin/operation/:slug/units — replace the set of Units
 * participating in this Operation.
 *
 * Body: { units: [{ unitSlug }] }
 *
 *   (Unit)-[:PARTICIPATED_IN]->(Operation)
 *
 * Mirrors the Person→Operation participation edge — units involved in the
 * op are not necessarily affiliated with the orchestrating organisation
 * (e.g. an RAF squadron flying for SOE, or a Wehrmacht unit pursuing).
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

interface UnitInput { unitSlug: string }
interface Body { units?: UnitInput[] }

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const slug = String(params.slug)
  const body = await request.json<Body>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)
  const units = body.units
  if (!Array.isArray(units)) return json({ error: 'units must be an array' }, 400)

  for (const u of units) {
    if (typeof u.unitSlug !== 'string' || !u.unitSlug) {
      return json({ error: 'Bad unitSlug' }, 400)
    }
  }

  try {
    await runCypher(env, `
      MATCH (:Unit)-[r:PARTICIPATED_IN]->(op:Operation {slug: $slug}) DELETE r
    `, { slug })

    if (units.length) {
      await runCypher(env, `
        MATCH (op:Operation {slug: $slug})
        UNWIND $items AS x
        OPTIONAL MATCH (u:Unit {slug: x.unitSlug})
        FOREACH (_ IN CASE WHEN u IS NOT NULL THEN [1] ELSE [] END |
          MERGE (u)-[:PARTICIPATED_IN]->(op)
        )
      `, { slug, items: units.map(u => ({ unitSlug: u.unitSlug })) })
    }
    return json({ ok: true, count: units.length })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
