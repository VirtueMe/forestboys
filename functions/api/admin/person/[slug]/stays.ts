/**
 * PATCH /api/admin/person/:slug/stays — replace a Person's STATIONED_AT edges.
 *
 * Body: { stays: [{ id?, place: 'location:<slug>' | 'station:<slug>', role?, startDate?, endDate? }] }
 * Returns: { ok, ids } — stay ids in input order (new stays get fresh ids).
 *
 * See functions/_lib/stays.ts for state / note handling.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import type { Neo4jEnv } from '~/_lib/neo4j.ts'
import { parsePlace, replaceStays, stayFieldError, type StayInput } from '~/_lib/stays.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

interface Body {
  stays?: (StayInput & { place?: string })[]
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const personSlug = String(params.slug)
  const body = await request.json<Body>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)
  if (!Array.isArray(body.stays)) return json({ error: 'stays must be an array' }, 400)

  const stays = []
  for (const s of body.stays) {
    const place = parsePlace(s.place)
    if (!place) return json({ error: `Bad place: ${String(s.place)}` }, 400)
    const err = stayFieldError(s)
    if (err) return json({ error: err }, 400)
    stays.push({
      id:         s.id ?? null,
      personSlug,
      placeKind:  place.kind,
      placeSlug:  place.slug,
      role:       s.role ?? null,
      startDate:  s.startDate ?? null,
      endDate:    s.endDate ?? null,
    })
  }

  try {
    const out = await replaceStays(env, { side: 'person', personSlug }, stays)
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
