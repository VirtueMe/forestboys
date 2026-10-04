/**
 * PATCH /api/admin/event/:slug/sections — replace the description sections of
 * an Operation or Incident (HAS_CONTENT → Description), each with optional
 * CITES and SOURCED_FROM edges. Same payload as the person and page editors:
 *
 *   { sections: [{ order, content, citations?: [{inline, sourceId}], sourcedFromId? }] }
 *
 * The node that holds a section's slot is updated in place, so the text
 * imported from Sanity keeps the id the nightly sync tracks
 * (functions/_lib/event-sections.ts).
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'
import { planSections, validateSections } from '~/_lib/event-sections.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

const EVENT = `(e:Operation|Incident {slug: $slug})`

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const slug = String(params.slug)
  const body = await request.json<{ sections?: unknown }>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)
  const checked = validateSections(body.sections)
  if ('error' in checked) return json({ error: checked.error }, 400)

  try {
    const found = await runCypher<{ slug: string }>(env, `MATCH ${EVENT} RETURN e.slug AS slug`, { slug })
    if (!found.length) return json({ error: `Fant ikke hendelsen ${slug}.` }, 404)

    const existing = await runCypher<{ id: string; order: number }>(env, `
      MATCH ${EVENT}
      MATCH (e)-[:HAS_CONTENT]->(d:Description)
      RETURN d.id AS id, coalesce(d.order, 1) AS order
    `, { slug })
    const plan = planSections(slug, existing, checked.sections)

    if (plan.deleteIds.length) {
      await runCypher(env, `MATCH (d:Description) WHERE d.id IN $ids DETACH DELETE d`, { ids: plan.deleteIds })
    }
    if (plan.update.length) {
      await runCypher(env, `
        UNWIND $sections AS s
        MATCH (d:Description {id: s.id})
        SET d.content = s.content, d.order = s.order
        WITH d
        OPTIONAL MATCH (d)-[r:CITES|SOURCED_FROM]->()
        DELETE r
      `, { sections: plan.update })
    }
    if (plan.create.length) {
      await runCypher(env, `
        MATCH ${EVENT}
        UNWIND $sections AS s
        CREATE (e)-[:HAS_CONTENT {order: s.order}]->(:Description { id: s.id, order: s.order, content: s.content })
      `, { slug, sections: plan.create })
    }

    const all = [...plan.update, ...plan.create]
    if (all.length) {
      await runCypher(env, `
        UNWIND $sections AS s
        MATCH (d:Description {id: s.id})
        OPTIONAL MATCH (fromSrc:Source {id: s.sourcedFromId})
        FOREACH (_ IN CASE WHEN s.sourcedFromId IS NOT NULL AND fromSrc IS NOT NULL THEN [1] ELSE [] END |
          CREATE (d)-[:SOURCED_FROM]->(fromSrc)
        )
        WITH d, s
        UNWIND (CASE WHEN size(s.citations) > 0 THEN s.citations ELSE [null] END) AS cite
        OPTIONAL MATCH (citeSrc:Source {id: cite.sourceId})
        FOREACH (_ IN CASE WHEN cite IS NOT NULL AND citeSrc IS NOT NULL THEN [1] ELSE [] END |
          CREATE (d)-[:CITES {inline: cite.inline}]->(citeSrc)
        )
      `, { sections: all })
    }

    return json({ ok: true, count: all.length })
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
