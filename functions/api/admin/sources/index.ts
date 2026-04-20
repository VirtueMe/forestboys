/**
 * /api/admin/sources
 *
 *   GET  — list sources with usage counts
 *          ?q=<search> (case-insensitive substring on title)
 *          ?limit=50 (max 200), ?offset=0
 *          → { rows: ListRow[], total: number }
 *   POST — create a new Source node
 *          Body: { title: string, url?, authorFreeText?, type? }
 *          → { id, title, url, authorFreeText }
 *
 * Usage = incoming edges (CITES, HAS_HERO_IMAGE, etc). usage=0 → safe to delete.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

const TYPES = new Set(['website', 'book', 'article', 'archive'])
// SPDX IDs are open-ended (plus LicenseRef-*, NOASSERTION, expressions) —
// validate shape not membership. Length cap guards against abuse.
const LICENSE_RE = /^[A-Za-z0-9 .+\-()]{1,120}$/

interface CreateSourceBody {
  title?:          unknown
  url?:            unknown
  authorFreeText?: unknown
  type?:           unknown
  license?:        unknown
  attribution?:    unknown
}

interface SourceRow {
  id:             string
  title:          string | null
  url:            string | null
  authorFreeText: string | null
  license:        string | null
  attribution:    string | null
}

interface ListRow extends SourceRow {
  type:  string | null
  usage: number
}

interface TotalRow {
  total: number
}

function slugify(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/å/g, 'a')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const url    = new URL(request.url)
  const q      = url.searchParams.get('q') ?? ''
  const limit  = Math.min(Math.max(Number(url.searchParams.get('limit')  ?? 50), 1), 200)
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0), 0)

  try {
    const filter = q
      ? 'WHERE s.title IS NOT NULL AND toLower(s.title) CONTAINS toLower($q)'
      : ''

    const rows = await runCypher<ListRow>(env, `
      MATCH (s:Source)
      ${filter}
      OPTIONAL MATCH (s)<-[r]-()
      WITH s, count(r) AS usage
      RETURN s.id AS id, s.title AS title, s.url AS url,
             s.authorFreeText AS authorFreeText, s.type AS type,
             s.license AS license, s.attribution AS attribution,
             usage
      ORDER BY coalesce(s.title, s.id)
      SKIP $offset LIMIT $limit
    `, { q, limit, offset })

    const totalRows = await runCypher<TotalRow>(env, `
      MATCH (s:Source)
      ${filter}
      RETURN count(s) AS total
    `, { q })

    return json({ rows, total: totalRows[0]?.total ?? 0 })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const body = await request.json<CreateSourceBody>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return json({ error: 'title is required' }, 400)

  const url            = typeof body.url            === 'string' && body.url.trim()            ? body.url.trim()            : null
  const authorFreeText = typeof body.authorFreeText === 'string' && body.authorFreeText.trim() ? body.authorFreeText.trim() : null
  const type           = typeof body.type           === 'string' && TYPES.has(body.type)       ? body.type                  : 'website'
  const license        = typeof body.license        === 'string' && LICENSE_RE.test(body.license) ? body.license             : null
  const attribution    = typeof body.attribution    === 'string' && body.attribution.trim()    ? body.attribution.trim()    : null

  const slug = slugify(title) || 'source'
  const id   = `src-${slug}-${Date.now().toString(36)}`

  try {
    const rows = await runCypher<SourceRow>(env, `
      CREATE (s:Source {
        id:             $id,
        title:          $title,
        type:           $type,
        url:            $url,
        authorFreeText: $author,
        license:        $license,
        attribution:    $attribution
      })
      RETURN s.id AS id, s.title AS title, s.url AS url,
             s.authorFreeText AS authorFreeText,
             s.license AS license, s.attribution AS attribution
    `, { id, title, type, url, author: authorFreeText, license, attribution })

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
