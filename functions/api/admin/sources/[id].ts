/**
 * /api/admin/sources/:id
 *
 *   PATCH  — update Source fields (title, url, authorFreeText, type)
 *   DELETE — remove the Source, but only if no other node references it
 *            (no incoming edges). Returns 409 with usage count otherwise.
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
  license?:        unknown
  attribution?:    unknown
}

interface SourceRow {
  id:             string
  title:          string | null
  url:            string | null
  authorFreeText: string | null
  type:           string | null
  license:        string | null
  attribution:    string | null
}

const TYPES = new Set(['website', 'book', 'article', 'archive'])
const LICENSE_RE = /^[A-Za-z0-9 .+\-()]{1,120}$/

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
  if ('license' in body) {
    if      (body.license === null)                                              props.license = null
    else if (typeof body.license === 'string' && LICENSE_RE.test(body.license))  props.license = body.license
    else                                                                         return json({ error: 'Bad license' }, 400)
  }
  if ('attribution' in body) {
    props.attribution = typeof body.attribution === 'string' && body.attribution.trim() ? body.attribution.trim() : null
  }

  if (!Object.keys(props).length) return json({ error: 'No fields to update' }, 400)

  try {
    const rows = await runCypher<SourceRow>(env, `
      MATCH (s:Source {id: $id})
      SET s += $props
      RETURN s.id AS id, s.title AS title, s.url AS url,
             s.authorFreeText AS authorFreeText, s.type AS type,
             s.license AS license, s.attribution AS attribution
    `, { id, props })

    if (!rows.length) return json({ error: 'Source not found' }, 404)
    return json({ ok: true, ...rows[0] })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

interface UsageRow {
  usage: number
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const id = String(params.id)
  if (!id) return json({ error: 'Missing source id' }, 400)

  try {
    const usage = await runCypher<UsageRow>(env, `
      MATCH (s:Source {id: $id})
      OPTIONAL MATCH (s)<-[r]-()
      RETURN count(r) AS usage
    `, { id })

    if (!usage.length) return json({ error: 'Source not found' }, 404)
    if (usage[0].usage > 0) return json({ error: 'Source is in use', usage: usage[0].usage }, 409)

    await runCypher(env, `MATCH (s:Source {id: $id}) DELETE s`, { id })
    return json({ ok: true, id })
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
