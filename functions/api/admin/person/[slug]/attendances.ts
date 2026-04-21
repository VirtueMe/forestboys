/**
 * PATCH /api/admin/person/:slug/attendances — replace ATTENDED edges on a Person.
 *
 * Body: { attendances: [{ unitSlug, startDate?, endDate? }] }
 *
 * Course attendance is a distinct concern from organisational membership:
 *   (Person)-[:ATTENDED {startDate, endDate}]->(Unit { type: "course" })
 *
 * OPTIONAL MATCH on unitSlug means unknown slugs silently skip. Non-course
 * Units also silently skip so admins can't accidentally wire a membership
 * via this endpoint.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'

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
    await runCypher(env, `
      MATCH (p:Person {slug: $slug})-[r:ATTENDED]->()
      DELETE r
    `, { slug })

    if (attendances.length) {
      await runCypher(env, `
        MATCH (p:Person {slug: $slug})
        UNWIND $items AS a
        OPTIONAL MATCH (u:Unit {slug: a.unitSlug})
        FOREACH (_ IN CASE WHEN u IS NOT NULL AND u.type = 'course' THEN [1] ELSE [] END |
          CREATE (p)-[:ATTENDED {
            startDate: a.startDate,
            endDate:   a.endDate,
            passed:    a.passed
          }]->(u)
        )
      `, {
        slug,
        items: attendances.map(a => ({
          unitSlug:  a.unitSlug,
          startDate: typeof a.startDate === 'string' ? a.startDate : null,
          endDate:   typeof a.endDate   === 'string' ? a.endDate   : null,
          passed:    typeof a.passed    === 'boolean' ? a.passed    : null,
        })),
      })
    }

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
