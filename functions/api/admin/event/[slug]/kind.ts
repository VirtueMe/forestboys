/**
 * PATCH /api/admin/event/:slug/kind — flip a node between Incident and Operation.
 *
 * Body: { kind: 'incident' | 'operation' }
 *
 * The rewrite is functions/_lib/event-kind.ts (one transaction). Demotion
 * refuses with the blocker list (ORCHESTRATED_BY orgs, participating units)
 * unless `force` — then those edges are stripped.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'
import { DEMOTE_BLOCKERS, DEMOTE_TO_INCIDENT, PROMOTE_TO_OPERATION } from '~/_lib/event-kind.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

interface Body {
  kind?:  'incident' | 'operation'
  /** Skip blocker check + auto-strip blocking edges. Demote-only. */
  force?: boolean
}

interface Blockers { orgs: { slug: string; name: string }[]; units: { slug: string; name: string }[] }

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const slug = String(params.slug)
  const body = await request.json<Body>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)
  const target = body.kind
  if (target !== 'incident' && target !== 'operation') {
    return json({ error: "kind must be 'incident' or 'operation'" }, 400)
  }

  try {
    const [current] = await runCypher<{ kind: string | null }>(env, `
      MATCH (n {slug: $slug})
      WHERE n:Incident OR n:Operation
      RETURN CASE WHEN 'Incident' IN labels(n) THEN 'incident'
                  WHEN 'Operation' IN labels(n) THEN 'operation'
                  ELSE NULL END AS kind
    `, { slug })

    if (!current?.kind) return json({ error: 'Node not found or not an Incident/Operation' }, 404)
    if (current.kind === target) return json({ ok: true, kind: target, unchanged: true })

    const slugs = [slug]
    if (target === 'operation') {
      await runCypher(env, PROMOTE_TO_OPERATION, { slugs })
      return json({ ok: true, kind: 'operation' })
    }

    if (!body.force) {
      const [b] = await runCypher<Blockers>(env, DEMOTE_BLOCKERS, { slugs })
      if (b && (b.orgs.length || b.units.length)) {
        return json({
          error: "Kan ikke endre til hendelse — fjern eller bekreft først.",
          blockers: { orgs: b.orgs, units: b.units },
        }, 409)
      }
    }
    await runCypher(env, DEMOTE_TO_INCIDENT, { slugs })
    return json({ ok: true, kind: 'incident' })
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
