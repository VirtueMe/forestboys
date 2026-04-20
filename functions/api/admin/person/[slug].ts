/**
 * PATCH /api/admin/person/:slug — update Grunnleggende (basic) fields on a Person.
 *
 * Body: { canonicalName?, secretName?, birthYear?, home? }
 * Accepts any subset of the keys. null clears a nullable field.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'

interface Env extends Neo4jEnv {
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

  try {
    const rows = await runCypher<PersonRow>(env, `
      MATCH (p:Person {slug: $slug})
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
