/**
 * PATCH /api/admin/station/:slug/names — replace the Station's other names
 * (HAS_NAME → Name): former and later names, aliases, each with an optional
 * period (a date can be "about") and sourceRefs.
 *
 * Body: { names: [{ id?, value, type, from?, fromAbout?, to?, toAbout?, sourceRefs? }] }
 * Returns: { ok, ids } — name ids in input order (new names get fresh ids).
 *
 * See functions/_lib/names.ts for the shape and the checks.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import type { Neo4jEnv } from '~/_lib/neo4j.ts'
import { replaceStationNames, validateNames } from '~/_lib/names.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const slug = String(params.slug)
  const body = await request.json<{ names?: unknown }>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)

  const checked = validateNames(body.names)
  if ('error' in checked) return json({ error: checked.error }, 400)

  try {
    const out = await replaceStationNames(env, slug, checked.names)
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
