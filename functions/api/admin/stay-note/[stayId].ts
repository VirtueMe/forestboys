/**
 * PATCH /api/admin/stay-note/:stayId
 *
 * Replace-all the note sections for one stay (one STATIONED_AT edge):
 *
 *   (Person)-[:HAS_STATIONED_NOTE]->(Description {stayId})-[:ABOUT_PLACE]->(place)
 *
 * Keyed by the edge's `id`, not the place, so two stays at the same place
 * keep separate notes. ABOUT_PLACE follows the edge's current place.
 *
 * Body: { sections: [{ order, content, citations?, sourcedFromId? }, ...] }
 *
 * Empty sections array clears the note (also fine for a stay that no
 * longer exists).
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, runCypherTx, type Neo4jEnv } from '~/_lib/neo4j.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

interface CitationInput {
  inline:   boolean
  sourceId: string
}

interface SectionInput {
  order:          number
  content:        string
  citations?:     CitationInput[]
  sourcedFromId?: string | null
}

interface Body {
  sections?: SectionInput[]
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const stayId = String(params.stayId)
  const body = await request.json<Body>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)
  const sections = body.sections
  if (!Array.isArray(sections)) return json({ error: 'sections must be an array' }, 400)

  for (const s of sections) {
    if (!Number.isInteger(s.order) || s.order < 1) return json({ error: `Bad section order: ${s.order}` }, 400)
    if (typeof s.content !== 'string') return json({ error: 'Bad section content' }, 400)
    try { JSON.parse(s.content) } catch { return json({ error: 'section content must be JSON' }, 400) }
    if (s.citations !== undefined) {
      if (!Array.isArray(s.citations)) return json({ error: 'Bad citations type' }, 400)
      for (const c of s.citations) {
        if (typeof c.sourceId !== 'string' || !c.sourceId) return json({ error: 'Bad citation sourceId' }, 400)
        if (typeof c.inline   !== 'boolean')                return json({ error: 'Bad citation inline' }, 400)
      }
    }
    if (s.sourcedFromId !== undefined && s.sourcedFromId !== null && typeof s.sourcedFromId !== 'string') {
      return json({ error: 'Bad sourcedFromId' }, 400)
    }
  }

  const payload = sections.map(s => ({
    id:            `desc:stay:${stayId}:${s.order}`,
    order:         s.order,
    content:       s.content,
    citations:     s.citations ?? [],
    sourcedFromId: typeof s.sourcedFromId === 'string' ? s.sourcedFromId : null,
  }))

  const wipe = {
    statement:  `MATCH (:Person)-[:HAS_STATIONED_NOTE]->(d:Description {stayId: $stayId}) DETACH DELETE d`,
    parameters: { stayId },
  }

  try {
    if (!payload.length) {
      await runCypher(env, wipe.statement, wipe.parameters)
      return json({ ok: true, count: 0 })
    }

    const found = await runCypher(env,
      `MATCH (:Person)-[r:STATIONED_AT {id: $stayId}]->() RETURN r.id AS id`, { stayId })
    if (!found.length) return json({ error: `Oppholdet finnes ikke: ${stayId}` }, 404)

    await runCypherTx(env, [wipe, {
      statement: `
        MATCH (p:Person)-[:STATIONED_AT {id: $stayId}]->(pl)
        UNWIND $sections AS s
        CREATE (p)-[:HAS_STATIONED_NOTE]->(d:Description {
          id: s.id, stayId: $stayId, order: s.order, content: s.content
        })
        CREATE (d)-[:ABOUT_PLACE]->(pl)
        WITH d, s
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
      `,
      parameters: { stayId, sections: payload },
    }])

    return json({ ok: true, count: payload.length })
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
