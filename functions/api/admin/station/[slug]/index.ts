/**
 * POST /api/admin/station/new — create a new Station with its scalar
 * fields in one shot. Body must include { slug, canonicalName } plus
 * optional type, category, sourceRefs and coordinates. Returns { ok, slug } so the client
 * can navigate to /station/:slug.
 *
 * PATCH /api/admin/station/:slug — update scalar fields on an existing
 * Station. Body fields are all optional; only included fields are
 * written. Mirror of the Organization PATCH.
 *
 * The URL slug is always the sentinel `new` for POST; the real slug
 * comes from the body. Collision is scoped to :Station.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'
import { STATION_CATEGORIES, isStationCategory } from '~/_lib/station-category.ts'
import { parseSourceRefs, unknownSources } from '~/_lib/source-refs.ts'

interface Env extends Neo4jEnv { SESSION_SECRET: string }

interface CreateBody {
  slug?:          string
  canonicalName?: string
  type?:          string | null
  category?:      string | null
  sourceRefs?:    unknown
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
  if (body.category !== undefined && body.category !== null && !isStationCategory(body.category)) {
    return json({ error: `category må være ${STATION_CATEGORIES.join(', ')} eller null` }, 400)
  }
  const refs = await checkSourceRefs(env, body.sourceRefs)
  if ('error' in refs) return json({ error: refs.error }, 400)

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
        category:      $category,
        sourceRefs:    $sourceRefs,
        lat:           $lat,
        lng:           $lng
      })
    `, {
      slug,
      canonicalName: body.canonicalName.trim(),
      type:          norm(body.type),
      category:      body.category ?? null,
      sourceRefs:    refs.refs,
      lat, lng,
    })

    return json({ ok: true, slug })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

interface PatchBody {
  name?:       string
  type?:       string | null
  category?:   string | null
  sourceRefs?: unknown
  lat?:        number | null
  lng?:        number | null
  activeFrom?: string | null
  activeTo?:   string | null
}

function isStringOrNull(v: unknown): v is string | null {
  return v === null || typeof v === 'string'
}

function isDateOrNull(v: unknown): v is string | null {
  if (v === null) return true
  return typeof v === 'string' && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(v)
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
  if (body.type !== undefined && !isStringOrNull(body.type)) {
    return json({ error: 'type must be a string or null' }, 400)
  }
  if (body.category !== undefined && body.category !== null && !isStationCategory(body.category)) {
    return json({ error: `category må være ${STATION_CATEGORIES.join(', ')} eller null` }, 400)
  }
  let sourceRefs: string[] | undefined
  if (body.sourceRefs !== undefined) {
    const refs = await checkSourceRefs(env, body.sourceRefs)
    if ('error' in refs) return json({ error: refs.error }, 400)
    sourceRefs = refs.refs
  }
  for (const f of ['lat', 'lng'] as const) {
    const v = body[f]
    if (v !== undefined && v !== null && (typeof v !== 'number' || !Number.isFinite(v))) {
      return json({ error: `${f} must be a number or null` }, 400)
    }
  }
  for (const f of ['activeFrom', 'activeTo'] as const) {
    if (body[f] !== undefined && !isDateOrNull(body[f])) {
      return json({ error: `${f} must be YYYY, YYYY-MM, YYYY-MM-DD, or null` }, 400)
    }
  }

  const setClauses: string[] = []
  const params2: Record<string, unknown> = { slug }

  if (body.name       !== undefined) { setClauses.push('s.canonicalName = $canonicalName'); params2.canonicalName = body.name.trim() }
  if (body.type       !== undefined) { setClauses.push('s.type       = $type');       params2.type       = typeof body.type === 'string' ? (body.type.trim() || null) : body.type }
  if (body.category   !== undefined) { setClauses.push('s.category   = $category');   params2.category   = body.category }
  if (sourceRefs      !== undefined) { setClauses.push('s.sourceRefs = $sourceRefs');   params2.sourceRefs = sourceRefs }
  if (body.lat        !== undefined) { setClauses.push('s.lat        = $lat');        params2.lat        = body.lat }
  if (body.lng        !== undefined) { setClauses.push('s.lng        = $lng');        params2.lng        = body.lng }
  if (body.activeFrom !== undefined) { setClauses.push('s.activeFrom = $activeFrom'); params2.activeFrom = body.activeFrom }
  if (body.activeTo   !== undefined) { setClauses.push('s.activeTo   = $activeTo');   params2.activeTo   = body.activeTo }

  if (!setClauses.length) return json({ ok: true, unchanged: true })

  try {
    const [updated] = await runCypher<{
      name: string | null; type: string | null; category: string | null; sourceRefs: string[] | null;
      lat: number | null; lng: number | null;
      activeFrom: string | null; activeTo: string | null;
    }>(env, `
      MATCH (s:Station {slug: $slug})
      SET ${setClauses.join(', ')}
      RETURN coalesce(s.canonicalName, s.title) AS name,
             s.type        AS type,
             s.category    AS category,
             s.sourceRefs  AS sourceRefs,
             s.lat         AS lat,
             s.lng         AS lng,
             s.activeFrom  AS activeFrom,
             s.activeTo    AS activeTo
    `, params2)

    if (!updated) return json({ error: 'Station not found' }, 404)
    return json({ ok: true, ...updated })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

const MAX_SOURCE_REFS = 50

/** The Station's sources: well-formed refs, each naming a Source that exists. */
async function checkSourceRefs(env: Neo4jEnv, v: unknown): Promise<{ refs: string[] } | { error: string }> {
  if (v === undefined || v === null) return { refs: [] }
  const parsed = parseSourceRefs(v)
  if ('error' in parsed) return parsed
  if (parsed.refs.length > MAX_SOURCE_REFS) return { error: `For mange kilder (maks ${MAX_SOURCE_REFS})` }
  const missing = await unknownSources(env, parsed.refs)
  if (missing.length) return { error: `Kilden finnes ikke: ${missing.join(', ')}` }
  return parsed
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
