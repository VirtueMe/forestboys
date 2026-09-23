/**
 * POST /api/admin/ranks — create a Rank.
 *
 * Body: { slug, canonicalName, abbreviation?, tier?, countries?, branchSlug? }
 * `branchSlug` links the rank to its service branch via
 * (:Rank)-[:IN]->(:Organization). Collision is scoped to :Rank.
 * Reads go through neo4jQuery on the client; only writes live here.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'
import { parseRankFields } from '~/_lib/rank-fields.ts'

interface Env extends Neo4jEnv { SESSION_SECRET: string }

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const body = await request.json<Record<string, unknown>>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)

  const slug = body.slug
  if (typeof slug !== 'string' || !/^[a-z0-9-]+$/.test(slug)) return json({ error: 'slug må være små bokstaver, tall og bindestrek' }, 400)
  if (!('canonicalName' in body)) return json({ error: 'canonicalName må være en tekst' }, 400)

  const parsed = parseRankFields(body)
  if ('error' in parsed) return json({ error: parsed.error }, 400)
  const { props, branchSlug } = parsed

  try {
    const [hit] = await runCypher<{ exists: boolean }>(env,
      `OPTIONAL MATCH (r:Rank {slug: $slug}) RETURN r IS NOT NULL AS exists`,
      { slug })
    if (hit?.exists) return json({ error: `Slug finnes allerede for en grad: ${slug}` }, 409)

    if (typeof branchSlug === 'string') {
      const [org] = await runCypher<{ exists: boolean }>(env,
        `OPTIONAL MATCH (o:Organization {slug: $branchSlug}) RETURN o IS NOT NULL AS exists`,
        { branchSlug })
      if (!org?.exists) return json({ error: `Ukjent organisasjon: ${branchSlug}` }, 400)
    }

    await runCypher(env, `
      CREATE (r:Rank {slug: $slug})
      SET r += $props
      WITH r
      OPTIONAL MATCH (o:Organization {slug: $branchSlug})
      FOREACH (_ IN CASE WHEN o IS NOT NULL THEN [1] ELSE [] END | CREATE (r)-[:IN]->(o))
    `, { slug, props, branchSlug: branchSlug ?? null })

    return json({ ok: true, slug })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
