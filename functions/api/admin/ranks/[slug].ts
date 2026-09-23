/**
 * /api/admin/ranks/:slug
 *
 *   PATCH  — update canonicalName / abbreviation / tier / countries, and/or move the
 *            rank to another branch (`branchSlug`, null detaches).
 *   DELETE — remove the Rank, but only if no Person holds it
 *            (HELD_RANK). Returns 409 with the holder count otherwise.
 *
 * Slug is immutable — Person rank editors reference ranks by slug.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'
import { parseRankFields } from '~/_lib/rank-fields.ts'

interface Env extends Neo4jEnv { SESSION_SECRET: string }

interface RankRow {
  slug:         string
  name:         string
  abbreviation: string | null
  tier:         number | null
  countries:    string[] | null
  branchSlug:   string | null
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const slug = String(params.slug)
  const body = await request.json<Record<string, unknown>>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)

  const parsed = parseRankFields(body)
  if ('error' in parsed) return json({ error: parsed.error }, 400)
  const { props, branchSlug } = parsed
  if (!Object.keys(props).length && branchSlug === undefined) return json({ ok: true, unchanged: true })

  try {
    if (typeof branchSlug === 'string') {
      const [hit] = await runCypher<{ exists: boolean }>(env,
        `OPTIONAL MATCH (o:Organization {slug: $branchSlug}) RETURN o IS NOT NULL AS exists`,
        { branchSlug })
      if (!hit?.exists) return json({ error: `Ukjent organisasjon: ${branchSlug}` }, 400)
    }

    const rows = await runCypher<RankRow>(env, `
      MATCH (r:Rank {slug: $slug})
      SET r += $props
      RETURN r.slug AS slug
    `, { slug, props })
    if (!rows.length) return json({ error: 'Rank not found' }, 404)

    if (branchSlug !== undefined) {
      await runCypher(env, `
        MATCH (r:Rank {slug: $slug})
        OPTIONAL MATCH (r)-[old:IN]->(:Organization)
        DELETE old
        WITH DISTINCT r
        OPTIONAL MATCH (o:Organization {slug: $branchSlug})
        FOREACH (_ IN CASE WHEN o IS NOT NULL THEN [1] ELSE [] END | CREATE (r)-[:IN]->(o))
      `, { slug, branchSlug })
    }

    const [row] = await runCypher<RankRow>(env, `
      MATCH (r:Rank {slug: $slug})
      OPTIONAL MATCH (r)-[:IN]->(b:Organization)
      RETURN r.slug AS slug, r.canonicalName AS name, r.abbreviation AS abbreviation,
             r.tier AS tier, r.countries AS countries, b.slug AS branchSlug
    `, { slug })
    return json({ ok: true, ...row })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const slug = String(params.slug)
  try {
    const [usage] = await runCypher<{ holders: number }>(env, `
      MATCH (r:Rank {slug: $slug})
      OPTIONAL MATCH (:Person)-[h:HELD_RANK]->(r)
      RETURN count(h) AS holders
    `, { slug })

    if (!usage) return json({ error: 'Rank not found' }, 404)
    if (usage.holders > 0) return json({ error: 'Graden er i bruk', holders: usage.holders }, 409)

    await runCypher(env, `MATCH (r:Rank {slug: $slug}) DETACH DELETE r`, { slug })
    return json({ ok: true, slug })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
