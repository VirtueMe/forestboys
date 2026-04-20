/**
 * POST /api/admin/sources — create a new Source node.
 *
 * Body: { title: string, url?: string, authorFreeText?: string, type?: string }
 * Returns: { id, title, url, authorFreeText }
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

interface CreateSourceBody {
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
}

const TYPES = new Set(['website', 'book', 'article', 'archive'])

function slugify(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/å/g, 'a')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const body = await request.json<CreateSourceBody>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return json({ error: 'title is required' }, 400)

  const url            = typeof body.url === 'string' && body.url.trim()            ? body.url.trim()            : null
  const authorFreeText = typeof body.authorFreeText === 'string' && body.authorFreeText.trim() ? body.authorFreeText.trim() : null
  const type           = typeof body.type === 'string' && TYPES.has(body.type)      ? body.type                  : 'website'

  const slug = slugify(title) || 'source'
  const id   = `src-${slug}-${Date.now().toString(36)}`

  try {
    const rows = await runCypher<SourceRow>(env, `
      CREATE (s:Source {
        id:             $id,
        title:          $title,
        type:           $type,
        url:            $url,
        authorFreeText: $author
      })
      RETURN s.id AS id, s.title AS title, s.url AS url, s.authorFreeText AS authorFreeText
    `, { id, title, type, url, author: authorFreeText })

    if (!rows.length) return json({ error: 'Failed to create Source' }, 502)
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
