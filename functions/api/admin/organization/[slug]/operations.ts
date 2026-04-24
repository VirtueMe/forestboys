/**
 * PATCH /api/admin/organization/:slug/operations — replace the set of
 * Operations ORCHESTRATED_BY this Organization. Mirror of /units.
 *
 * Body: { operations: [{ operationSlug }, ...] }
 *
 * Existing ORCHESTRATED_BY edges to operations not in the list are
 * removed; new ones for operations in the list are MERGE'd. No other
 * edge metadata is touched.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

interface Body {
  operations?: { operationSlug: string }[]
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const slug = String(params.slug)
  const body = await request.json<Body>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)
  if (!Array.isArray(body.operations)) return json({ error: 'operations must be an array' }, 400)
  for (const o of body.operations) {
    if (typeof o.operationSlug !== 'string' || !o.operationSlug) {
      return json({ error: 'Bad operationSlug' }, 400)
    }
  }

  const keepSlugs = body.operations.map(o => o.operationSlug)

  try {
    await runCypher(env, `
      MATCH (op:Operation)-[r:ORCHESTRATED_BY]->(o:Organization {slug: $slug})
      WHERE NOT op.slug IN $keepSlugs
      DELETE r
    `, { slug, keepSlugs })

    if (keepSlugs.length) {
      await runCypher(env, `
        MATCH (o:Organization {slug: $slug})
        UNWIND $keepSlugs AS opSlug
        MATCH (op:Operation {slug: opSlug})
        MERGE (op)-[:ORCHESTRATED_BY]->(o)
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
