/**
 * PATCH /api/admin/operation/:slug/organizations — replace the set of
 * Organizations orchestrating this Operation.
 *
 * Body: { organizations: [{ organizationSlug }] }
 *
 *   (Operation)-[:ORCHESTRATED_BY]->(Organization)
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

interface OrgInput { organizationSlug: string }
interface Body { organizations?: OrgInput[] }

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const slug = String(params.slug)
  const body = await request.json<Body>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)
  const organizations = body.organizations
  if (!Array.isArray(organizations)) return json({ error: 'organizations must be an array' }, 400)

  for (const o of organizations) {
    if (typeof o.organizationSlug !== 'string' || !o.organizationSlug) {
      return json({ error: 'Bad organizationSlug' }, 400)
    }
  }

  try {
    await runCypher(env, `
      MATCH (op:Operation {slug: $slug})-[r:ORCHESTRATED_BY]->(:Organization) DELETE r
    `, { slug })

    if (organizations.length) {
      await runCypher(env, `
        MATCH (op:Operation {slug: $slug})
        UNWIND $items AS x
        OPTIONAL MATCH (o:Organization {slug: x.organizationSlug})
        FOREACH (_ IN CASE WHEN o IS NOT NULL THEN [1] ELSE [] END |
          MERGE (op)-[:ORCHESTRATED_BY]->(o)
        )
      `, { slug, items: organizations.map(o => ({ organizationSlug: o.organizationSlug })) })
    }
    return json({ ok: true, count: organizations.length })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
