/**
 * PATCH /api/admin/organization/:slug/units — replace the PART_OF edges from
 * Units into this Organization. Each incoming entry carries role and order.
 * Description is modelled separately as a Description node via
 * HAS_MEMBER_UNIT_NOTE — see /member-unit-note/:unitSlug. sourceRefs on
 * existing edges is preserved (MERGE + SET named fields only).
 *
 * Body: { units: [{ unitSlug, role?, order? }, ...] }
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

interface UnitInput {
  unitSlug: string
  role?:    string | null
  order?:   number | null
}

interface Body {
  units?: UnitInput[]
}

const VALID_ROLES = new Set(['administrative', 'operational', 'sponsor', 'parent'])

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const slug = String(params.slug)
  const body = await request.json<Body>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)
  const units = body.units
  if (!Array.isArray(units)) return json({ error: 'units must be an array' }, 400)

  for (const u of units) {
    if (typeof u.unitSlug !== 'string' || !u.unitSlug) return json({ error: 'Bad unitSlug' }, 400)
    if (u.role !== undefined && u.role !== null && !VALID_ROLES.has(u.role)) {
      return json({ error: `Bad role: ${u.role}` }, 400)
    }
    if (u.order !== undefined && u.order !== null && (!Number.isInteger(u.order) || u.order < 0)) {
      return json({ error: `Bad order: ${u.order}` }, 400)
    }
  }

  const payload = units.map(u => ({
    unitSlug: u.unitSlug,
    role:     u.role ?? null,
    order:    typeof u.order === 'number' ? u.order : null,
  }))

  try {
    const keepSlugs = payload.map(p => p.unitSlug)

    // Delete PART_OF edges not in the incoming list
    await runCypher(env, `
      MATCH (u:Unit)-[r:PART_OF]->(o:Organization {slug: $slug})
      WHERE NOT u.slug IN $keepSlugs
      DELETE r
    `, { slug, keepSlugs })

    if (payload.length) {
      await runCypher(env, `
        MATCH (o:Organization {slug: $slug})
        UNWIND $units AS row
        MATCH (u:Unit {slug: row.unitSlug})
        MERGE (u)-[r:PART_OF]->(o)
        SET r.role  = row.role,
            r.order = row.order
      `, { slug, units: payload })
    }

    return json({ ok: true, count: payload.length })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
