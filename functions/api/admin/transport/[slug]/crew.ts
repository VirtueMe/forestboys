/**
 * PATCH /api/admin/transport/:slug/crew — replace the CREW_OF edges into this
 * Transport.
 *
 * Body: { crew: [{ id?, personSlug, role?, startDate?, endDate? }] }
 * Returns: { ok, ids } — edge ids in input order (new rows get fresh ids).
 *
 * See functions/_lib/crew.ts.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import type { Neo4jEnv } from '~/_lib/neo4j.ts'
import { replaceCrew, type CrewInput } from '~/_lib/crew.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

interface Body {
  crew?: CrewInput[]
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const body = await request.json<Body>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)
  if (!Array.isArray(body.crew)) return json({ error: 'crew must be an array' }, 400)

  try {
    const out = await replaceCrew(env, String(params.slug), body.crew)
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
