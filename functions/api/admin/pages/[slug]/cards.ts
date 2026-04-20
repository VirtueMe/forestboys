/**
 * PATCH /api/admin/pages/:slug/cards — batch update editable Card fields.
 *
 * Body: { items: [{ id, order?, title?, layout?, kind?, headingLevel? }, ...] }
 *
 * Each item updates only the fields present. Admin role required.
 * Cards must belong to the Page (enforced via :slug match).
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

const LAYOUTS = new Set(['full', 'half', 'third', 'quarter'])
const KINDS   = new Set(['card', 'text'])

interface Section {
  order:   number
  content: string
}

interface Item {
  id:            string
  order?:        number
  title?:        string | null
  layout?:       string
  kind?:         string
  headingLevel?: number | null
  sections?:     Section[]
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const slug = String(params.slug)
  let body: { items?: Item[] }
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const items = body.items
  if (!Array.isArray(items) || !items.length) return json({ error: 'Missing items[]' }, 400)

  for (const it of items) {
    if (typeof it.id !== 'string' || !it.id.startsWith(`card:${slug}:`)) {
      return json({ error: `Bad card id for page ${slug}: ${it.id}` }, 400)
    }
    if (it.order !== undefined && (!Number.isInteger(it.order) || it.order < 1)) {
      return json({ error: `Bad order: ${it.order}` }, 400)
    }
    if (it.layout !== undefined && !LAYOUTS.has(it.layout)) {
      return json({ error: `Bad layout: ${it.layout}` }, 400)
    }
    if (it.kind !== undefined && !KINDS.has(it.kind)) {
      return json({ error: `Bad kind: ${it.kind}` }, 400)
    }
    if (it.headingLevel !== undefined && it.headingLevel !== null &&
        (!Number.isInteger(it.headingLevel) || it.headingLevel < 1 || it.headingLevel > 3)) {
      return json({ error: `Bad headingLevel: ${it.headingLevel}` }, 400)
    }
    if (it.title !== undefined && it.title !== null && typeof it.title !== 'string') {
      return json({ error: `Bad title type for ${it.id}` }, 400)
    }
    if (it.sections !== undefined) {
      if (!Array.isArray(it.sections)) return json({ error: `Bad sections type for ${it.id}` }, 400)
      for (const s of it.sections) {
        if (!Number.isInteger(s.order) || s.order < 1) return json({ error: `Bad section order: ${s.order}` }, 400)
        if (typeof s.content !== 'string') return json({ error: `Bad section content type for ${it.id}` }, 400)
        try { JSON.parse(s.content) } catch { return json({ error: `section content is not valid JSON for ${it.id}` }, 400) }
      }
    }
  }

  // Scalar prop updates (first pass).
  const propItems = items
    .filter(it => it.order !== undefined || it.title !== undefined || it.layout !== undefined
               || it.kind  !== undefined || it.headingLevel !== undefined)
    .map(it => {
      const props: Record<string, unknown> = {}
      if (it.order        !== undefined) props.order        = it.order
      if (it.title        !== undefined) props.title        = it.title
      if (it.layout       !== undefined) props.layout       = it.layout
      if (it.kind         !== undefined) props.kind         = it.kind
      if (it.headingLevel !== undefined) props.headingLevel = it.headingLevel
      return { id: it.id, props }
    })

  const sectionItems = items
    .filter(it => it.sections !== undefined)
    .map(it => ({
      id:       it.id,
      sections: (it.sections ?? []).map(s => ({
        id:      `${it.id.replace('card:', 'desc:')}:${s.order}`,
        order:   s.order,
        content: s.content,
      })),
    }))

  try {
    if (propItems.length) {
      const rows = await runCypher<{ id: string }>(env, `
        UNWIND $items AS it
        MATCH (p:Page {slug: $slug})-[:HAS_CARD]->(c:Card {id: it.id})
        SET c += it.props
        RETURN c.id AS id
      `, { slug, items: propItems })
      if (rows.length !== propItems.length) {
        return json({ error: `Updated ${rows.length} of ${propItems.length} card props` }, 409)
      }
    }

    // Replace-all semantics for sections: delete existing HAS_CONTENT + orphan
    // Descriptions for each touched card, then recreate from the payload.
    for (const it of sectionItems) {
      await runCypher(env, `
        MATCH (p:Page {slug: $slug})-[:HAS_CARD]->(c:Card {id: $cardId})
        OPTIONAL MATCH (c)-[r:HAS_CONTENT]->(d:Description)
        DELETE r, d
      `, { slug, cardId: it.id })

      if (it.sections.length) {
        await runCypher(env, `
          MATCH (p:Page {slug: $slug})-[:HAS_CARD]->(c:Card {id: $cardId})
          UNWIND $sections AS s
          CREATE (c)-[:HAS_CONTENT]->(d:Description { id: s.id, order: s.order, content: s.content })
        `, { slug, cardId: it.id, sections: it.sections })
      }
    }

    return json({ ok: true, updated: items.length })
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
