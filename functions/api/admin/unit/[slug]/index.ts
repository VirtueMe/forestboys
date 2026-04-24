/**
 * POST /api/admin/unit/new — create a new Unit with all scalar fields in
 * one shot. Body must include { slug, canonicalName } plus any optional
 * fields. Returns { ok, slug } so the client can navigate to
 * /district/:slug.
 *
 * The URL slug is always the sentinel `new`; the real slug comes from
 * the body. Collision is scoped to :Unit.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'

interface Env extends Neo4jEnv { SESSION_SECRET: string }

interface CreateBody {
  slug?:           string
  canonicalName?:  string
  formalName?:     string | null
  color?:          string | null
  country?:        string | null
  foundedDate?:    string | null
  dissolvedDate?:  string | null
}

function isDateOrNull(v: unknown): v is string | null {
  if (v === null || v === undefined) return true
  return typeof v === 'string' && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(v)
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

    return json({ ok: true, slug })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
