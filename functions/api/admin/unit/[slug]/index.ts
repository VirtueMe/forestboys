/**
 * POST /api/admin/unit/new — create a new Unit with all scalar fields in
 * one shot. Body must include { slug, canonicalName } plus any optional
 * fields. Returns { ok, slug } so the client can navigate to
 * /district/:slug.
 *
 * PATCH /api/admin/unit/:slug — update scalar fields on an existing Unit.
 * Body fields are all optional; only included fields are written. Mirror
 * of the Organization PATCH.
 *
 * The URL slug is always the sentinel `new` for POST; the real slug comes
 * from the body. Collision is scoped to :Unit.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'
import { invalidateSitemap, type SitemapBinding } from '~/_lib/sitemap.ts'

interface Env extends Neo4jEnv, SitemapBinding { SESSION_SECRET: string }

interface Body {
  name?:           string
  formalName?:     string | null
  color?:          string | null
  country?:        string | null
  foundedDate?:    string | null
  dissolvedDate?:  string | null
}

interface CreateBody {
  slug?:           string
  canonicalName?:  string
  formalName?:     string | null
  color?:          string | null
  country?:        string | null
  foundedDate?:    string | null
  dissolvedDate?:  string | null
}

function isStringOrNull(v: unknown): v is string | null {
  return v === null || typeof v === 'string'
}

function isDateOrNull(v: unknown): v is string | null {
  if (v === null || v === undefined) return true
  return typeof v === 'string' && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(v)
}

function norm(s: unknown): string | null {
  return typeof s === 'string' && s.trim() ? s.trim() : null
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params, waitUntil }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  if (String(params.slug) !== 'new') return json({ error: 'POST requires URL slug "new"' }, 400)

  const body = await request.json<CreateBody>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)

  const slug = body.slug
  if (typeof slug !== 'string' || !/^[a-z0-9-]+$/.test(slug)) return json({ error: 'slug må være små bokstaver, tall og bindestrek' }, 400)
  if (slug === 'new') return json({ error: 'slug "new" er reservert' }, 400)
  if (typeof body.canonicalName !== 'string' || !body.canonicalName.trim()) return json({ error: 'canonicalName må være en tekst' }, 400)

  for (const f of ['foundedDate', 'dissolvedDate'] as const) {
    if (body[f] !== undefined && !isDateOrNull(body[f])) return json({ error: `${f} must be YYYY, YYYY-MM, YYYY-MM-DD, or null` }, 400)
  }

  try {
    const [hit] = await runCypher<{ exists: boolean }>(env,
      `OPTIONAL MATCH (n:Unit {slug: $slug}) RETURN n IS NOT NULL AS exists`,
      { slug })
    if (hit?.exists) return json({ error: `Slug finnes allerede for en avdeling: ${slug}` }, 409)

    await runCypher(env, `
      CREATE (u:Unit {
        slug:          $slug,
        canonicalName: $canonicalName,
        formalName:    $formalName,
        color:         $color,
        country:       $country,
        foundedDate:   $foundedDate,
        dissolvedDate: $dissolvedDate
      })
    `, {
      slug,
      canonicalName: body.canonicalName.trim(),
      formalName:    norm(body.formalName),
      color:         norm(body.color),
      country:       norm(body.country),
      foundedDate:   body.foundedDate ?? null,
      dissolvedDate: body.dissolvedDate ?? null,
    })

    waitUntil(invalidateSitemap(env))

    return json({ ok: true, slug })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const slug = String(params.slug)
  const body = await request.json<Body>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)

  if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) {
    return json({ error: 'name must be a non-empty string' }, 400)
  }
  for (const f of ['formalName', 'color', 'country'] as const) {
    if (body[f] !== undefined && !isStringOrNull(body[f])) {
      return json({ error: `${f} must be a string or null` }, 400)
    }
  }
  for (const f of ['foundedDate', 'dissolvedDate'] as const) {
    if (body[f] !== undefined && !isDateOrNull(body[f])) {
      return json({ error: `${f} must be YYYY, YYYY-MM, YYYY-MM-DD, or null` }, 400)
    }
  }

  const setClauses: string[] = []
  const params2: Record<string, unknown> = { slug }

  const pushField = (prop: string, key: string, value: unknown, trim = true) => {
    setClauses.push(`u.${prop} = $${key}`)
    params2[key] = typeof value === 'string' && trim ? (value.trim() || null) : value
  }

  if (body.name          !== undefined) { setClauses.push('u.canonicalName = $canonicalName'); params2.canonicalName = body.name.trim() }
  if (body.formalName    !== undefined) pushField('formalName',    'formalName',    body.formalName)
  if (body.color         !== undefined) pushField('color',         'color',         body.color)
  if (body.country       !== undefined) pushField('country',       'country',       body.country)
  if (body.foundedDate   !== undefined) pushField('foundedDate',   'foundedDate',   body.foundedDate,   false)
  if (body.dissolvedDate !== undefined) pushField('dissolvedDate', 'dissolvedDate', body.dissolvedDate, false)

  if (!setClauses.length) return json({ ok: true, unchanged: true })

  try {
    const [updated] = await runCypher<{
      name: string | null; formalName: string | null;
      color: string | null; country: string | null;
      foundedDate: string | null; dissolvedDate: string | null;
    }>(env, `
      MATCH (u:Unit {slug: $slug})
      SET ${setClauses.join(', ')}
      RETURN u.canonicalName AS name,
             u.formalName    AS formalName,
             u.color         AS color,
             u.country       AS country,
             u.foundedDate   AS foundedDate,
             u.dissolvedDate AS dissolvedDate
    `, params2)

    if (!updated) return json({ error: 'Unit not found' }, 404)
    return json({ ok: true, ...updated })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
