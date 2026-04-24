/**
 * POST /api/admin/organization — create a skeleton :Organization node
 * with just { slug, canonicalName }. Everything else (description,
 * colour, founded date, relations) is filled in via the detail page's
 * scalar + section editors.
 *
 * Collision is scoped to :Organization — we allow the same slug across
 * different node types (a Person and an Organization can share a slug).
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'

interface Env extends Neo4jEnv { SESSION_SECRET: string }

interface Body { slug?: string; name?: string }

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const body = await request.json<Body>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)

  const { slug, name } = body
  if (typeof slug !== 'string' || !/^[a-z0-9-]+$/.test(slug)) return json({ error: 'slug må være små bokstaver, tall og bindestrek' }, 400)
  if (typeof name !== 'string' || !name.trim()) return json({ error: 'name må være en tekst' }, 400)

  try {
    const [hit] = await runCypher<{ exists: boolean }>(env,
      `OPTIONAL MATCH (n:Organization {slug: $slug}) RETURN n IS NOT NULL AS exists`,
      { slug })
    if (hit?.exists) return json({ error: `Slug finnes allerede for en organisasjon: ${slug}` }, 409)

    await runCypher(env,
      `CREATE (:Organization { slug: $slug, canonicalName: $name })`,
      { slug, name: name.trim() })

    return json({ ok: true, slug })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
