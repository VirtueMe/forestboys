/**
 * PATCH /api/admin/station/:slug/stays — replace the STATIONED_AT edges into
 * this Station, from the place side (e.g. a whole camp roster at once).
 *
 * Body: { stays: [{ id?, personSlug, role?, startDate?, endDate?, sourceRefs? }] }
 * Returns: { ok, ids } — stay ids in input order (new stays get fresh ids).
 *
 * See functions/_lib/stays.ts for state / note handling.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import type { Neo4jEnv } from '~/_lib/neo4j.ts'
import { replaceStays, stayFieldError, stayRefs, type StayInput } from '~/_lib/stays.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

interface Body {
  stays?: (StayInput & { personSlug?: string })[]
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const placeSlug = String(params.slug)
  const body = await request.json<Body>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)
  if (!Array.isArray(body.stays)) return json({ error: 'stays must be an array' }, 400)

  const stays = []
  for (const s of body.stays) {
    if (typeof s.personSlug !== 'string' || !s.personSlug) return json({ error: 'Bad personSlug' }, 400)
    const err = stayFieldError(s)
    if (err) return json({ error: err }, 400)
    stays.push({
      id:         s.id ?? null,
      personSlug: s.personSlug,
      placeKind:  'station' as const,
      placeSlug,
      role:       s.role ?? null,
      startDate:  s.startDate ?? null,
      endDate:    s.endDate ?? null,
      sourceRefs: stayRefs(s),
    })
  }

  try {
    const out = await replaceStays(env, { side: 'place', placeKind: 'station', placeSlug }, stays)
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
