/**
 * POST /api/admin/event — create an Incident or Operation.
 *
 * Body: { kind: 'incident' | 'operation', slug, name, date?, forPerson? }
 *
 * When `forPerson` is a Person slug, also creates the appropriate edge in
 * the same transaction (INVOLVED_IN for incident, PARTICIPATED_IN for
 * operation), so the PersonDetail caller lands back with the relation
 * already wired.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

interface Body {
  kind?:      'incident' | 'operation'
  slug?:      string
  name?:      string
  date?:      string | null
  forPerson?: string | null
}

function isDateOrNull(v: unknown): v is string | null {
  if (v === null || v === undefined) return true
  return typeof v === 'string' && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(v)
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const body = await request.json<Body>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)

  const { kind, slug, name, date, forPerson } = body
  if (kind !== 'incident' && kind !== 'operation') return json({ error: "kind must be 'incident' or 'operation'" }, 400)
  if (typeof slug !== 'string' || !/^[a-z0-9-]+$/.test(slug)) return json({ error: 'slug must be lowercase kebab-case' }, 400)
  if (typeof name !== 'string' || !name.trim()) return json({ error: 'name must be a non-empty string' }, 400)
  if (!isDateOrNull(date)) return json({ error: `Bad date: ${String(date)}` }, 400)
  if (forPerson !== undefined && forPerson !== null && (typeof forPerson !== 'string' || !forPerson)) {
    return json({ error: 'Bad forPerson' }, 400)
  }

  const label    = kind === 'operation' ? 'Operation' : 'Incident'
  const nameProp = kind === 'operation' ? 'codeName' : 'title'
  const personEdge = kind === 'operation' ? 'PARTICIPATED_IN' : 'INVOLVED_IN'

  try {
    const [collision] = await runCypher<{ exists: boolean }>(env, `
      OPTIONAL MATCH (n {slug: $slug})
      RETURN n IS NOT NULL AS exists
    `, { slug })
    if (collision?.exists) return json({ error: `Slug already in use: ${slug}` }, 409)

    await runCypher(env, `
      CREATE (n:${label} { slug: $slug, ${nameProp}: $name, date: $date })
      WITH n
      OPTIONAL MATCH (p:Person {slug: $forPerson})
      FOREACH (_ IN CASE WHEN p IS NOT NULL THEN [1] ELSE [] END |
        CREATE (p)-[:${personEdge}]->(n)
      )
    `, { slug, name: name.trim(), date: date ?? null, forPerson: forPerson ?? null })

    return json({ ok: true, slug, kind })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
