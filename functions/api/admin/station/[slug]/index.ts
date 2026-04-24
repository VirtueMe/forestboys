/**
 * POST /api/admin/station/new — create a new Station with its scalar
 * fields in one shot. Body must include { slug, canonicalName } plus
 * optional type and coordinates. Returns { ok, slug } so the client
 * can navigate to /station/:slug.
 *
 * The URL slug is always the sentinel `new`; the real slug comes from
 * the body. Collision is scoped to :Station.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'

interface Env extends Neo4jEnv { SESSION_SECRET: string }

interface CreateBody {
  slug?:          string
  canonicalName?: string
  type?:          string | null
  lat?:           number | null
  lng?:           number | null
}

function norm(s: unknown): string | null {
  return typeof s === 'string' && s.trim() ? s.trim() : null
}

function coord(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v !== 'number' || !Number.isFinite(v)) return NaN
  return v
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

  const lat = coord(body.lat)
  const lng = coord(body.lng)
  if (Number.isNaN(lat) || Number.isNaN(lng)) return json({ error: 'lat/lng must be numbers or null' }, 400)

  try {
    const [hit] = await runCypher<{ exists: boolean }>(env,
      `OPTIONAL MATCH (n:Station {slug: $slug}) RETURN n IS NOT NULL AS exists`,
      { slug })
    if (hit?.exists) return json({ error: `Slug finnes allerede for en stasjon: ${slug}` }, 409)

    await runCypher(env, `
      CREATE (s:Station {
        slug:          $slug,
        canonicalName: $canonicalName,
        type:          $type,
        lat:           $lat,
        lng:           $lng
      })
    `, {
      slug,
      canonicalName: body.canonicalName.trim(),
      type:          norm(body.type),
      lat, lng,
    })

    return json({ ok: true, slug })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
