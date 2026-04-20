/**
 * PATCH /api/admin/sources/:id — update an existing Source node.
 *
 * Body: { title?, url?, authorFreeText?, type? }
 * Returns: { id, title, url, authorFreeText, type }
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

interface UpdateSourceBody {
  title?:          unknown
  url?:            unknown
  authorFreeText?: unknown
  type?:           unknown
}

interface SourceRow {
  id:             string
  title:          string | null
  url:            string | null
  authorFreeText: string | null
  type:           string | null
}

const TYPES = new Set(['website', 'book', 'article', 'archive'])

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const id = String(params.id)
  if (!id) return json({ error: 'Missing source id' }, 400)

  const body = await request.json<UpdateSourceBody>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)

  const props: Record<string, unknown> = {}

  if ('title' in body) {
    const t = typeof body.title === 'string' ? body.title.trim() : ''
    if (!t) return json({ error: 'title cannot be empty' }, 400)
    props.title = t
  }
  if ('url' in body) {
    props.url = typeof body.url === 'string' && body.url.trim() ? body.url.trim() : null
  }
  if ('authorFreeText' in body) {
    props.authorFreeText = typeof body.authorFreeText === 'string' && body.authorFreeText.trim() ? body.authorFreeText.trim() : null
  }
  if ('type' in body) {
    if (typeof body.type !== 'string' || !TYPES.has(body.type)) return json({ error: `Bad type: ${String(body.type)}` }, 400)
    props.type = body.type
  }

  if (!Object.keys(props).length) return json({ error: 'No fields to update' }, 400)

  try {
    const rows = await runCypher<SourceRow>(env, `
      MATCH (s:Source {id: $id})
      SET s += $props
      RETURN s.id AS id, s.title AS title, s.url AS url, s.authorFreeText AS authorFreeText, s.type AS type
    `, { id, props })

    if (!rows.length) return json({ error: 'Source not found' }, 404)
    return json({ ok: true, ...rows[0] })
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
