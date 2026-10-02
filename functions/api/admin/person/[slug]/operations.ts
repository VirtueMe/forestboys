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
import type { Neo4jEnv } from '~/_lib/neo4j.ts'
import { saveEdgeSet } from '~/_lib/edge-set.ts'

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
    await saveEdgeSet(env, {
      anchor: { label: 'Person', slug }, rel: 'PARTICIPATED_IN', direction: 'out', targetLabel: 'Operation',
      items: operations.map(o => ({ slug: o.operationSlug })),
    })

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
