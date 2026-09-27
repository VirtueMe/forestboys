/**
 * PATCH /api/admin/equipment/:slug/sections — replace the EquipmentType's
 * Description sections (HAS_CONTENT → Description), each with optional
 * CITES and SOURCED_FROM edges. Mirror of /api/admin/organization/:slug/sections.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'

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

  const slug = String(params.slug)
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
    id:            `desc:equipment:${slug}:${s.order}`,
    order:         s.order,
    content:       s.content,
    citations:     s.citations ?? [],
    sourcedFromId: typeof s.sourcedFromId === 'string' ? s.sourcedFromId : null,
  }))

  try {
    await runCypher(env, `
      MATCH (s:EquipmentType {slug: $slug})-[r:HAS_CONTENT]->(d:Description)
      DETACH DELETE d
    `, { slug })

    if (payload.length) {
      await runCypher(env, `
        MATCH (s:EquipmentType {slug: $slug})
        UNWIND $sections AS sec
        CREATE (s)-[:HAS_CONTENT]->(d:Description { id: sec.id, order: sec.order, content: sec.content })
        WITH d, sec
        OPTIONAL MATCH (fromSrc:Source {id: sec.sourcedFromId})
        FOREACH (_ IN CASE WHEN sec.sourcedFromId IS NOT NULL AND fromSrc IS NOT NULL THEN [1] ELSE [] END |
          CREATE (d)-[:SOURCED_FROM]->(fromSrc)
        )
        WITH d, sec
        UNWIND (CASE WHEN size(sec.citations) > 0 THEN sec.citations ELSE [null] END) AS cite
        OPTIONAL MATCH (citeSrc:Source {id: cite.sourceId})
        FOREACH (_ IN CASE WHEN cite IS NOT NULL AND citeSrc IS NOT NULL THEN [1] ELSE [] END |
          CREATE (d)-[:CITES {inline: cite.inline}]->(citeSrc)
        )
      `, { slug, sections: payload })
    }

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
