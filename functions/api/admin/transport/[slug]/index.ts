/**
 * POST /api/admin/transport/new — create a new Transport with its
 * scalar fields in one shot. Body must include { slug, canonicalName }
 * plus optional type. Returns { ok, slug } so the client can navigate
 * to /transport/:slug.
 *
 * PATCH /api/admin/transport/:slug — update scalar fields on an
 * existing Transport. Body fields are all optional; only included
 * fields are written. Mirror of the Organization PATCH.
 *
 * The URL slug is always the sentinel `new` for POST; the real slug
 * comes from the body. Collision is scoped to :Transport.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'
import { invalidateSitemap, type SitemapBinding } from '~/_lib/sitemap.ts'

interface Env extends Neo4jEnv, SitemapBinding { SESSION_SECRET: string }

interface CreateBody {
  slug?:          string
  canonicalName?: string
  type?:          string | null
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

    waitUntil(invalidateSitemap(env))

    return json({ ok: true, slug })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

interface PatchBody {
  name?:    string
  type?:    string | null
  unit?:    string | null
  regser?:  string | null
  reserve?: string | null
}

function isStringOrNull(v: unknown): v is string | null {
  return v === null || typeof v === 'string'
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
  for (const f of ['type', 'unit', 'regser', 'reserve'] as const) {
    if (body[f] !== undefined && !isStringOrNull(body[f])) {
      return json({ error: `${f} must be a string or null` }, 400)
    }
  }

  const setClauses: string[] = []
  const params2: Record<string, unknown> = { slug }

  const pushField = (prop: string, key: string, value: unknown) => {
    setClauses.push(`t.${prop} = $${key}`)
    params2[key] = typeof value === 'string' ? (value.trim() || null) : value
  }

  if (body.name    !== undefined) { setClauses.push('t.canonicalName = $canonicalName'); params2.canonicalName = body.name.trim() }
  if (body.type    !== undefined) pushField('type',    'type',    body.type)
  if (body.unit    !== undefined) pushField('unit',    'unit',    body.unit)
  if (body.regser  !== undefined) pushField('regser',  'regser',  body.regser)
  if (body.reserve !== undefined) pushField('reserve', 'reserve', body.reserve)

  if (!setClauses.length) return json({ ok: true, unchanged: true })

  try {
    const [updated] = await runCypher<{
      name: string | null; type: string | null;
      unit: string | null; regser: string | null; reserve: string | null;
    }>(env, `
      MATCH (t:Transport {slug: $slug})
      SET ${setClauses.join(', ')}
      RETURN coalesce(t.canonicalName, t.name) AS name,
             t.type    AS type,
             t.unit    AS unit,
             t.regser  AS regser,
             t.reserve AS reserve
    `, params2)

    if (!updated) return json({ error: 'Transport not found' }, 404)
    return json({ ok: true, ...updated })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
