/**
 * PATCH /api/admin/person/:slug — update Grunnleggende (basic) fields on a Person.
 *
 * Body: { canonicalName?, secretName?, birthYear?, home?, type? }
 * Accepts any subset of the keys. null clears a nullable field.
 *
 * A claim field whose value changes is marked `<field>_sourceRef: 'admin-edit'`
 * and `<field>_state: 'verified'` (`unknown` when cleared), like the known
 * rank — so the Sanity sync can tell a graph edit from an older Sanity state
 * (docs/SANITY-SYNC.md, "Review — no baseline").
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'
import { invalidateSitemap, type SitemapBinding } from '~/_lib/sitemap.ts'

interface Env extends Neo4jEnv, SitemapBinding {
  SESSION_SECRET: string
}

interface UpdateBody {
  canonicalName?: unknown
  secretName?:    unknown
  birthYear?:     unknown
  home?:          unknown
  type?:          unknown
}

interface PersonRow {
  slug:          string
  canonicalName: string
  secretName:    string | null
  birthYear:     number | null
  home:          string | null
  type:          string | null
}

const PERSON_TYPES = new Set(['civilian', 'soldier'])

/** Fields carrying claim provenance. `type` too: the sync and the rank editor derive it
 *  from the rank, and a type chosen here must win (`type_sourceRef: 'admin-edit'`). */
const CLAIM_FIELDS = ['canonicalName', 'secretName', 'birthYear', 'home', 'type'] as const

/**
 * POST /api/admin/person/new — create a new Person with all scalar fields
 * in one shot. Body must include { slug, canonicalName } plus any optional
 * fields. Returns { ok, slug } so the client can navigate to /person/:slug.
 *
 * The URL slug is always the sentinel `new`; the real slug comes from
 * the body. Collision is scoped to :Person.
 */
interface CreateBody {
  slug?:          unknown
  canonicalName?: unknown
  secretName?:    unknown
  birthYear?:     unknown
  home?:          unknown
  type?:          unknown
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

  const type = typeof body.type === 'string' && PERSON_TYPES.has(body.type) ? body.type : 'civilian'

  let birthYear: number | null = null
  if (body.birthYear !== null && body.birthYear !== undefined) {
    if (typeof body.birthYear !== 'number' || !Number.isInteger(body.birthYear)) {
      return json({ error: 'birthYear must be an integer or null' }, 400)
    }
    birthYear = body.birthYear
  }

  const secretName = typeof body.secretName === 'string' && body.secretName.trim() ? body.secretName.trim() : null
  const home       = typeof body.home       === 'string' && body.home.trim()       ? body.home.trim()       : null

  try {
    const [hit] = await runCypher<{ exists: boolean }>(env,
      `OPTIONAL MATCH (n:Person {slug: $slug}) RETURN n IS NOT NULL AS exists`,
      { slug })
    if (hit?.exists) return json({ error: `Slug finnes allerede for en person: ${slug}` }, 409)

    await runCypher(env, `
      CREATE (p:Person {
        slug:          $slug,
        canonicalName: $canonicalName,
        secretName:    $secretName,
        home:          $home,
        birthYear:     $birthYear,
        type:          $type
      })
    `, {
      slug,
      canonicalName: body.canonicalName.trim(),
      secretName, home, birthYear, type,
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
  const body = await request.json<UpdateBody>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)

  const props: Record<string, unknown> = {}

  if ('canonicalName' in body) {
    if (typeof body.canonicalName !== 'string' || !body.canonicalName.trim()) {
      return json({ error: 'canonicalName must be a non-empty string' }, 400)
    }
    props.canonicalName = body.canonicalName.trim()
  }
  if ('secretName' in body) {
    props.secretName = typeof body.secretName === 'string' && body.secretName.trim() ? body.secretName.trim() : null
  }
  if ('birthYear' in body) {
    if (body.birthYear === null) props.birthYear = null
    else if (typeof body.birthYear !== 'number' || !Number.isInteger(body.birthYear)) {
      return json({ error: 'birthYear must be an integer or null' }, 400)
    }
    else props.birthYear = body.birthYear
  }
  if ('home' in body) {
    props.home = typeof body.home === 'string' && body.home.trim() ? body.home.trim() : null
  }
  if ('type' in body) {
    if (typeof body.type !== 'string' || !PERSON_TYPES.has(body.type)) {
      return json({ error: 'type must be "civilian" or "soldier"' }, 400)
    }
    props.type = body.type
  }

  if (!Object.keys(props).length) return json({ error: 'No fields to update' }, 400)

  // Mark before `SET p += $props`, only where the stored value differs.
  const marks = CLAIM_FIELDS.filter(f => f in props).map(f => `
      FOREACH (_ IN CASE WHEN p.${f} = $props.${f} OR (p.${f} IS NULL AND $props.${f} IS NULL) THEN [] ELSE [1] END |
        SET p.${f}_sourceRef = 'admin-edit',
            p.${f}_state = CASE WHEN $props.${f} IS NULL THEN 'unknown' ELSE 'verified' END)`).join('')

  try {
    const rows = await runCypher<PersonRow>(env, `
      MATCH (p:Person {slug: $slug})${marks}
      SET p += $props
      RETURN p.slug AS slug, p.canonicalName AS canonicalName,
             p.secretName AS secretName, p.birthYear AS birthYear,
             p.home AS home, p.type AS type
    `, { slug, props })

    if (!rows.length) return json({ error: 'Person not found' }, 404)
    return json({ ok: true, ...rows[0] })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
