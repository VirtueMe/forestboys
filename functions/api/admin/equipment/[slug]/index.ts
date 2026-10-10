/**
 * POST /api/admin/equipment/new — create a new EquipmentType. Body must
 * include { slug, canonicalName } plus optional type / subtype /
 * country / period. Returns { ok, slug } so the client can navigate to
 * /equipment/:slug.
 *
 * PATCH /api/admin/equipment/:slug — update scalar fields on an existing
 * EquipmentType. Body fields are all optional; only included fields are
 * written. Mirror of the Location / Station endpoints.
 *
 * The URL slug is always the sentinel `new` for POST; the real slug
 * comes from the body. Collision is scoped to :EquipmentType.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'
import { invalidateSitemap, type SitemapBinding } from '~/_lib/sitemap.ts'

interface Env extends Neo4jEnv, SitemapBinding { SESSION_SECRET: string }

// Controlled vocabulary from the graph schema; `null` clears the type.
const TYPES = new Set(['radio', 'weapon', 'explosive', 'navigation', 'survival', 'vehicle-accessory', 'medical'])

interface Fields {
  canonicalName?: string
  type?:          string | null
  subtype?:       string | null
  country?:       string | null
  period?:        string | null
}

/** Validates the optional scalar fields present in `body`. */
function parseFields(body: Record<string, unknown>): Fields | { error: string } {
  const out: Fields = {}
  if ('canonicalName' in body) {
    const v = typeof body.canonicalName === 'string' ? body.canonicalName.trim() : ''
    if (!v) return { error: 'canonicalName må være en tekst' }
    out.canonicalName = v
  }
  if ('type' in body) {
    const v = body.type
    if (v !== null && (typeof v !== 'string' || !TYPES.has(v))) return { error: `Ukjent type: ${JSON.stringify(v)}` }
    out.type = v
  }
  for (const f of ['subtype', 'period'] as const) {
    if (f in body) {
      const v = body[f]
      if (v !== null && typeof v !== 'string') return { error: `${f} må være tekst eller null` }
      out[f] = typeof v === 'string' && v.trim() ? v.trim() : null
    }
  }
  if ('country' in body) {
    const v = body.country
    if (v !== null && (typeof v !== 'string' || !/^[A-Za-z]{2}$/.test(v.trim()))) return { error: 'country må være en landkode på to bokstaver (NO, UK, …)' }
    out.country = typeof v === 'string' ? v.trim().toUpperCase() : null
  }
  return out
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params, waitUntil }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  if (String(params.slug) !== 'new') return json({ error: 'POST requires URL slug "new"' }, 400)

  const body = await request.json<Record<string, unknown>>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)

  const slug = body.slug
  if (typeof slug !== 'string' || !/^[a-z0-9-]+$/.test(slug)) return json({ error: 'slug må være små bokstaver, tall og bindestrek' }, 400)
  if (slug === 'new') return json({ error: 'slug "new" er reservert' }, 400)
  if (!('canonicalName' in body)) return json({ error: 'canonicalName må være en tekst' }, 400)

  const fields = parseFields(body)
  if ('error' in fields) return json({ error: fields.error }, 400)

  try {
    const [hit] = await runCypher<{ exists: boolean }>(env,
      `OPTIONAL MATCH (e:EquipmentType {slug: $slug}) RETURN e IS NOT NULL AS exists`,
      { slug })
    if (hit?.exists) return json({ error: `Slug finnes allerede for utstyr: ${slug}` }, 409)

    await runCypher(env, `CREATE (e:EquipmentType {slug: $slug}) SET e += $props`, { slug, props: fields })
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
  const body = await request.json<Record<string, unknown>>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)

  const fields = parseFields(body)
  if ('error' in fields) return json({ error: fields.error }, 400)
  if (!Object.keys(fields).length) return json({ ok: true, unchanged: true })

  try {
    const [updated] = await runCypher<{
      canonicalName: string | null; type: string | null; subtype: string | null;
      country: string | null; period: string | null;
    }>(env, `
      MATCH (e:EquipmentType {slug: $slug})
      SET e += $props
      RETURN e.canonicalName AS canonicalName, e.type AS type, e.subtype AS subtype,
             e.country AS country, e.period AS period
    `, { slug, props: fields })

    if (!updated) return json({ error: 'EquipmentType not found' }, 404)
    return json({ ok: true, ...updated })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
