/**
 * PATCH /api/admin/operation/:slug/persons — replace PARTICIPATED_IN edges
 * from the Operation side. Mirror of /api/admin/incident/:slug/persons.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

interface PersonInput { personSlug: string }
interface Body { persons?: PersonInput[] }

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const slug = String(params.slug)
  const body = await request.json<Body>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)
  const persons = body.persons
  if (!Array.isArray(persons)) return json({ error: 'persons must be an array' }, 400)

  for (const p of persons) {
    if (typeof p.personSlug !== 'string' || !p.personSlug) return json({ error: 'Bad personSlug' }, 400)
  }

  try {
    await runCypher(env, `
      MATCH ()-[r:PARTICIPATED_IN]->(op:Operation {slug: $slug}) DELETE r
    `, { slug })

    if (persons.length) {
      await runCypher(env, `
        MATCH (op:Operation {slug: $slug})
        UNWIND $items AS x
        OPTIONAL MATCH (p:Person {slug: x.personSlug})
        FOREACH (_ IN CASE WHEN p IS NOT NULL THEN [1] ELSE [] END |
          CREATE (p)-[:PARTICIPATED_IN]->(op)
        )
      `, { slug, items: persons.map(p => ({ personSlug: p.personSlug })) })
    }
    return json({ ok: true, count: persons.length })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
