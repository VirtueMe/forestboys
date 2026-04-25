/**
 * POST /api/admin/transport/new — create a new Transport with its
 * scalar fields in one shot. Body must include { slug, canonicalName }
 * plus optional type. Returns { ok, slug } so the client can navigate
 * to /transport/:slug.
 *
 * The URL slug is always the sentinel `new`; the real slug comes from
 * the body. Collision is scoped to :Transport.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'

interface Env extends Neo4jEnv { SESSION_SECRET: string }

interface CreateBody {
  slug?:          string
  canonicalName?: string
  type?:          string | null
}

function norm(s: unknown): string | null {
  return typeof s === 'string' && s.trim() ? s.trim() : null
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  if (String(params.slug) !== 'new') return json({ error: 'POST requires URL slug "new"' }, 400)

  const body = await request.json<CreateBody>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)

  const slug = body.slug
  if (typeof slug !== 'string' || !/^[a-z0-9-]+$/.test(slug)) return json({ error: 'slug må være små bokstaver, tall og bindestrek' }, 400)
  if (slug === 'new') return json({ error: 'slug "new" er reservert' }, 400)
  if (typeof body.canonicalName !== 'string' || !body.canonicalName.trim()) return json({ error: 'canonicalName må være en tekst' }, 400)

  try {
    const [hit] = await runCypher<{ exists: boolean }>(env,
      `OPTIONAL MATCH (n:Transport {slug: $slug}) RETURN n IS NOT NULL AS exists`,
      { slug })
    if (hit?.exists) return json({ error: `Slug finnes allerede for et fremkomstmiddel: ${slug}` }, 409)

    await runCypher(env, `
      CREATE (t:Transport {
        slug:          $slug,
        canonicalName: $canonicalName,
        type:          $type
      })
    `, {
      slug,
      canonicalName: body.canonicalName.trim(),
      type:          norm(body.type),
    })

    return json({ ok: true, slug })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
