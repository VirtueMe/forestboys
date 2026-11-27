/**
 * PATCH /api/admin/event/:slug/crew — replace the crew of one transport on
 * this Operation or Incident.
 *
 * Body: { transportSlug, crew: [{ id?, personSlug, role? }] }
 * Returns: { ok, ids } — assignment ids in input order (new rows get fresh ids).
 *
 * See functions/_lib/event-crew.ts.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import type { Neo4jEnv } from '~/_lib/neo4j.ts'
import { replaceEventCrew, type EventCrewInput } from '~/_lib/event-crew.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

interface Body {
  transportSlug?: string
  crew?:          EventCrewInput[]
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const body = await request.json<Body>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)
  if (typeof body.transportSlug !== 'string' || !body.transportSlug) return json({ error: 'Bad transportSlug' }, 400)
  if (!Array.isArray(body.crew)) return json({ error: 'crew must be an array' }, 400)

  try {
    const out = await replaceEventCrew(env, String(params.slug), body.transportSlug, body.crew)
    if ('error' in out) return json({ error: out.error }, out.status)
    return json({ ok: true, ids: out.ids })
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
