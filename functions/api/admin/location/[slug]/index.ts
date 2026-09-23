/**
 * POST /api/admin/location/new — create a new Location with its scalar
 * fields in one shot. Body must include { slug, canonicalName } plus
 * optional coordinates. Returns { ok, slug } so the client can navigate
 * to /location/:slug.
 *
 * PATCH /api/admin/location/:slug — update scalar fields on an existing
 * Location. Body fields are all optional; only included fields are
 * written. Mirror of the Station PATCH.
 *
 * The URL slug is always the sentinel `new` for POST; the real slug
 * comes from the body. Collision is scoped to :Location.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'

interface Env extends Neo4jEnv { SESSION_SECRET: string }

interface CreateBody {
  slug?:          string
  canonicalName?: string
  lat?:           number | null
  lng?:           number | null
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
      `OPTIONAL MATCH (n:Location {slug: $slug}) RETURN n IS NOT NULL AS exists`,
      { slug })
    if (hit?.exists) return json({ error: `Slug finnes allerede for et sted: ${slug}` }, 409)

    await runCypher(env, `
      CREATE (l:Location {
        slug:          $slug,
        canonicalName: $canonicalName,
        lat:           $lat,
        lng:           $lng
      })
    `, {
      slug,
      canonicalName: body.canonicalName.trim(),
      lat, lng,
    })

    return json({ ok: true, slug })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

interface PatchBody {
  name?: string
  lat?:  number | null
  lng?:  number | null
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const slug = String(params.slug)
  const body = await request.json<PatchBody>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)

  if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) {
    return json({ error: 'name must be a non-empty string' }, 400)
  }
  for (const f of ['lat', 'lng'] as const) {
    const v = body[f]
    if (v !== undefined && v !== null && (typeof v !== 'number' || !Number.isFinite(v))) {
      return json({ error: `${f} must be a number or null` }, 400)
    }
  }

  const setClauses: string[] = []
  const params2: Record<string, unknown> = { slug }

  if (body.name !== undefined) { setClauses.push('l.canonicalName = $canonicalName'); params2.canonicalName = body.name.trim() }
  if (body.lat  !== undefined) { setClauses.push('l.lat = $lat'); params2.lat = body.lat }
  if (body.lng  !== undefined) { setClauses.push('l.lng = $lng'); params2.lng = body.lng }

  if (!setClauses.length) return json({ ok: true, unchanged: true })

  try {
    const [updated] = await runCypher<{ canonicalName: string | null; lat: number | null; lng: number | null }>(env, `
      MATCH (l:Location {slug: $slug})
      SET ${setClauses.join(', ')}
      RETURN coalesce(l.canonicalName, l.title) AS canonicalName,
             l.lat AS lat,
             l.lng AS lng
    `, params2)

    if (!updated) return json({ error: 'Location not found' }, 404)
    return json({ ok: true, ...updated })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
