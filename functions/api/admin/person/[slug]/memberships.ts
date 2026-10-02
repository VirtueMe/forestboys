/**
 * PATCH /api/admin/person/:slug/memberships — replace MEMBER_OF edges on a Person.
 *
 * Body: { memberships: [{ unitSlug, role?, startDate?, endDate?, description? }] }
 *
 * OPTIONAL MATCH on unitSlug means unknown slugs silently skip.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import type { Neo4jEnv } from '~/_lib/neo4j.ts'
import { saveEdgeSet } from '~/_lib/edge-set.ts'
import { findInvalidRole } from '~/_lib/role-scopes.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}


interface MembershipInput {
  unitSlug:   string
  role?:      string | null
  startDate?: string | null
  endDate?:   string | null
}

interface Body {
  memberships?: MembershipInput[]
}

function isDateOrNull(v: unknown): v is string | null {
  if (v === null || v === undefined) return true
  return typeof v === 'string' && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(v)
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const slug = String(params.slug)
  const body = await request.json<Body>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)
  const memberships = body.memberships
  if (!Array.isArray(memberships)) return json({ error: 'memberships must be an array' }, 400)

  for (const m of memberships) {
    if (typeof m.unitSlug !== 'string' || !m.unitSlug) return json({ error: 'Bad unitSlug' }, 400)
    if (!isDateOrNull(m.startDate)) return json({ error: `Bad startDate: ${String(m.startDate)} — use YYYY, YYYY-MM, or YYYY-MM-DD` }, 400)
    if (!isDateOrNull(m.endDate))   return json({ error: `Bad endDate: ${String(m.endDate)} — use YYYY, YYYY-MM, or YYYY-MM-DD` }, 400)
  }

  try {
    const badRole = await findInvalidRole(env, 'membership', memberships.map(m => m.role))
    if (badRole) return json({ error: `Ukjent rolle for denne koblingen: ${badRole}` }, 400)
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }

  try {
    await saveEdgeSet(env, {
      anchor: { label: 'Person', slug }, rel: 'MEMBER_OF', direction: 'out', targetLabel: 'Unit',
      targetWhere: "coalesce(t.type, '') <> 'course'",
      items: memberships.map(m => ({
        slug:  m.unitSlug,
        props: {
          role:      typeof m.role      === 'string' ? m.role      : null,
          startDate: typeof m.startDate === 'string' ? m.startDate : null,
          endDate:   typeof m.endDate   === 'string' ? m.endDate   : null,
        },
      })),
    })

    return json({ ok: true, count: memberships.length })
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
