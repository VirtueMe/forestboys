/**
 * PATCH /api/admin/unit/:slug/attendees — replace ATTENDED edges from the
 * Unit side. Mirror of /api/admin/person/:slug/attendances.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

interface AttendeeInput {
  personSlug: string
  passed?:    boolean | null
  startDate?: string | null
  endDate?:   string | null
}
interface Body { attendees?: AttendeeInput[] }

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
  const attendees = body.attendees
  if (!Array.isArray(attendees)) return json({ error: 'attendees must be an array' }, 400)

  for (const a of attendees) {
    if (typeof a.personSlug !== 'string' || !a.personSlug) return json({ error: 'Bad personSlug' }, 400)
    if (!isDateOrNull(a.startDate)) return json({ error: `Bad startDate: ${String(a.startDate)}` }, 400)
    if (!isDateOrNull(a.endDate))   return json({ error: `Bad endDate: ${String(a.endDate)}` }, 400)
    if (a.passed !== undefined && a.passed !== null && typeof a.passed !== 'boolean') {
      return json({ error: `Bad passed: ${String(a.passed)}` }, 400)
    }
  }

  try {
    await runCypher(env, `
      MATCH ()-[r:ATTENDED]->(u:Unit {slug: $slug}) DELETE r
    `, { slug })

    if (attendees.length) {
      await runCypher(env, `
        MATCH (u:Unit {slug: $slug})
        WHERE u.type = 'course'
        UNWIND $items AS x
        OPTIONAL MATCH (p:Person {slug: x.personSlug})
        FOREACH (_ IN CASE WHEN p IS NOT NULL THEN [1] ELSE [] END |
          CREATE (p)-[:ATTENDED {
            startDate: x.startDate,
            endDate:   x.endDate,
            passed:    x.passed
          }]->(u)
        )
      `, {
        slug,
        items: attendees.map(a => ({
          personSlug: a.personSlug,
          startDate:  typeof a.startDate === 'string' ? a.startDate : null,
          endDate:    typeof a.endDate   === 'string' ? a.endDate   : null,
          passed:     typeof a.passed    === 'boolean' ? a.passed   : null,
        })),
      })
    }
    return json({ ok: true, count: attendees.length })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
