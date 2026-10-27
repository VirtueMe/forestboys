/**
 * PATCH /api/admin/person/:slug/attendances — replace ATTENDED edges on a Person.
 *
 * Body: { attendances: [{ unitSlug, startDate?, endDate? }] }
 *
 * Course attendance is a distinct concern from organisational membership:
 *   (Person)-[:ATTENDED {startDate, endDate}]->(Unit { type: "course" })
 *
 * Unknown slugs silently skip. Non-course Units also silently skip so admins
 * can't accidentally wire a membership via this endpoint. Saved as a difference
 * (saveEdgeSet): an attendance that stays keeps its `order` in the course.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import type { Neo4jEnv } from '~/_lib/neo4j.ts'
import { saveEdgeSet } from '~/_lib/edge-set.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

interface AttendanceInput {
  unitSlug:   string
  startDate?: string | null
  endDate?:   string | null
  passed?:    boolean | null
}

interface Body {
  attendances?: AttendanceInput[]
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
  const attendances = body.attendances
  if (!Array.isArray(attendances)) return json({ error: 'attendances must be an array' }, 400)

  for (const a of attendances) {
    if (typeof a.unitSlug !== 'string' || !a.unitSlug) return json({ error: 'Bad unitSlug' }, 400)
    if (!isDateOrNull(a.startDate)) return json({ error: `Bad startDate: ${String(a.startDate)}` }, 400)
    if (!isDateOrNull(a.endDate))   return json({ error: `Bad endDate: ${String(a.endDate)}` }, 400)
    if (a.passed !== undefined && a.passed !== null && typeof a.passed !== 'boolean') {
      return json({ error: `Bad passed: ${String(a.passed)}` }, 400)
    }
  }

  try {
    await saveEdgeSet(env, {
      anchor: { label: 'Person', slug }, rel: 'ATTENDED', direction: 'out', targetLabel: 'Unit',
      targetWhere: `t.type = 'course'`,
      items: attendances.map(a => ({
        slug:  a.unitSlug,
        props: {
          startDate: typeof a.startDate === 'string' ? a.startDate : null,
          endDate:   typeof a.endDate   === 'string' ? a.endDate   : null,
          passed:    typeof a.passed    === 'boolean' ? a.passed    : null,
        },
      })),
    })

    return json({ ok: true, count: attendances.length })
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
