/**
 * POST /api/admin/event/:slug/rename-preview — what a rename of this event's slug would change (#96). Writes nothing.
 *
 * Body: { slug: string }  →  { ok, from, to, descriptions, links, restoresAlias }
 * or { error } with the status the rename itself would answer (409 when the slug is taken, by a page or an old address).
 *
 * The editor shows it before the rename is confirmed: «12 lenker i 5 beskrivelser oppdateres».
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'
import { planRename } from '~/_lib/slug-rename.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const from = String(params.slug)
  const body = await request.json<{ slug?: unknown }>().catch(() => null)
  if (!body || typeof body.slug !== 'string') return json({ error: 'slug required' }, 400)

  try {
    const [current] = await runCypher<{ label: 'Operation' | 'Incident' }>(env, `
      MATCH (n {slug: $slug}) WHERE n:Incident OR n:Operation
      RETURN CASE WHEN 'Operation' IN labels(n) THEN 'Operation' ELSE 'Incident' END AS label
    `, { slug: from }, 'Read')
    if (!current) return json({ error: 'Node not found or not an Incident/Operation' }, 404)

    const plan = await planRename(env, { label: current.label, from, to: body.slug })
    if ('error' in plan) return json({ error: plan.error }, plan.status)
    return json({
      ok: true, from: plan.from, to: plan.to,
      descriptions:  plan.rewrites.length,
      links:         plan.rewrites.reduce((n, r) => n + r.links, 0),
      restoresAlias: plan.restoresAlias,
    })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
