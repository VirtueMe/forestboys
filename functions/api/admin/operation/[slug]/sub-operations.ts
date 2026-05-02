/**
 * PATCH /api/admin/operation/:slug/sub-operations — replace the set of
 * child Operations contained by this Operation.
 *
 * Body: { children: [{ operationSlug }] }
 *
 *   (parent:Operation)-[:RELATED_TO {kind:'contains'}]->(child:Operation)
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

interface ChildInput { operationSlug: string }
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
    if (typeof c.operationSlug !== 'string' || !c.operationSlug) return json({ error: 'Bad operationSlug' }, 400)
    if (c.operationSlug === slug) return json({ error: 'An Operation cannot be its own child' }, 400)
  }

  try {
    await runCypher(env, `
      MATCH (parent:Operation {slug: $slug})-[r:RELATED_TO {kind:'contains'}]->(:Operation) DELETE r
    `, { slug })

    if (children.length) {
      await runCypher(env, `
        MATCH (parent:Operation {slug: $slug})
        UNWIND $items AS x
        OPTIONAL MATCH (child:Operation {slug: x.operationSlug})
        FOREACH (_ IN CASE WHEN child IS NOT NULL THEN [1] ELSE [] END |
          MERGE (parent)-[r:RELATED_TO]->(child)
          ON CREATE SET r.kind = 'contains'
          ON MATCH  SET r.kind = 'contains'
        )
      `, { slug, items: children.map(c => ({ operationSlug: c.operationSlug })) })
    }
    return json({ ok: true, count: children.length })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
