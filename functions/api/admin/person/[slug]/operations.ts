/**
 * PATCH /api/admin/person/:slug/operations — replace PARTICIPATED_IN edges.
 *
 * Body: { operations: [{ operationSlug }] }
 *
 *   (Person)-[:PARTICIPATED_IN]->(Operation)
 *
 * The edge carries no metadata; the Operation node owns codeName + dates.
 * Per-person descriptions live on HAS_OPERATION_NOTE → Description.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

interface OperationInput {
  operationSlug: string
}

interface Body {
  operations?: OperationInput[]
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const slug = String(params.slug)
  const body = await request.json<Body>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)
  const operations = body.operations
  if (!Array.isArray(operations)) return json({ error: 'operations must be an array' }, 400)

  for (const o of operations) {
    if (typeof o.operationSlug !== 'string' || !o.operationSlug) {
      return json({ error: 'Bad operationSlug' }, 400)
    }
  }

  try {
    await runCypher(env, `
      MATCH (p:Person {slug: $slug})-[r:PARTICIPATED_IN]->()
      DELETE r
    `, { slug })

    if (operations.length) {
      await runCypher(env, `
        MATCH (p:Person {slug: $slug})
        UNWIND $items AS x
        OPTIONAL MATCH (op:Operation {slug: x.operationSlug})
        FOREACH (_ IN CASE WHEN op IS NOT NULL THEN [1] ELSE [] END |
          CREATE (p)-[:PARTICIPATED_IN]->(op)
        )
      `, {
        slug,
        items: operations.map(o => ({ operationSlug: o.operationSlug })),
      })
    }

    return json({ ok: true, count: operations.length })
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
