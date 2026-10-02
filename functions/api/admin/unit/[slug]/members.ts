/**
 * PATCH /api/admin/unit/:slug/members — replace MEMBER_OF edges from the
 * Unit side. Mirror of /api/admin/person/:slug/memberships.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import type { Neo4jEnv } from '~/_lib/neo4j.ts'
import { saveEdgeSet } from '~/_lib/edge-set.ts'
import { findInvalidRole } from '~/_lib/role-scopes.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

interface MemberInput {
  personSlug: string
  role?:      string | null
  startDate?: string | null
  endDate?:   string | null
}
interface Body { members?: MemberInput[] }

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
  const members = body.members
  if (!Array.isArray(members)) return json({ error: 'members must be an array' }, 400)

  for (const m of members) {
    if (typeof m.personSlug !== 'string' || !m.personSlug) return json({ error: 'Bad personSlug' }, 400)
    if (!isDateOrNull(m.startDate)) return json({ error: `Bad startDate: ${String(m.startDate)}` }, 400)
    if (!isDateOrNull(m.endDate))   return json({ error: `Bad endDate: ${String(m.endDate)}` }, 400)
  }

  try {
    const badRole = await findInvalidRole(env, 'membership', members.map(m => m.role))
    if (badRole) return json({ error: `Ukjent rolle for denne koblingen: ${badRole}` }, 400)
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }

  try {
    await saveEdgeSet(env, {
      anchor: { label: 'Unit', slug }, rel: 'MEMBER_OF', direction: 'in', targetLabel: 'Person',
      items: members.map(m => ({
        slug:  m.personSlug,
        props: {
          role:      typeof m.role      === 'string' ? m.role      : null,
          startDate: typeof m.startDate === 'string' ? m.startDate : null,
          endDate:   typeof m.endDate   === 'string' ? m.endDate   : null,
        },
      })),
    })

    return json({ ok: true, count: members.length })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
