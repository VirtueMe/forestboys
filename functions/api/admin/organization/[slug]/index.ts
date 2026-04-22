/**
 * PATCH /api/admin/organization/:slug — update scalar fields on an Organization.
 *
 * Body (all optional, only included fields are written):
 *   {
 *     name?:          string             // → canonicalName (non-empty)
 *     formalName?:    string | null
 *     abbreviation?:  string | null
 *     sortingName?:   string | null
 *     color?:         string | null
 *     foundedDate?:   string | null      // YYYY | YYYY-MM | YYYY-MM-DD
 *     dissolvedDate?: string | null
 *     country?:       string | null
 *   }
 *
 * Response: { ok: true, ...updated fields }
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

interface Body {
  name?:          string
  formalName?:    string | null
  abbreviation?:  string | null
  sortingName?:   string | null
  color?:         string | null
  foundedDate?:   string | null
  dissolvedDate?: string | null
  country?:       string | null
}

function isDateOrNull(v: unknown): v is string | null {
  if (v === null) return true
  return typeof v === 'string' && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(v)
}
function isStringOrNull(v: unknown): v is string | null {
  return v === null || typeof v === 'string'
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
  for (const f of ['formalName', 'abbreviation', 'sortingName', 'color', 'country'] as const) {
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
    setClauses.push(`o.${prop} = $${key}`)
    params2[key] = typeof value === 'string' && trim ? (value.trim() || null) : value
  }

  if (body.name          !== undefined) { setClauses.push('o.canonicalName = $canonicalName'); params2.canonicalName = body.name.trim() }
  if (body.formalName    !== undefined) pushField('formalName',    'formalName',    body.formalName)
  if (body.abbreviation  !== undefined) pushField('abbreviation',  'abbreviation',  body.abbreviation)
  if (body.sortingName   !== undefined) pushField('sortingName',   'sortingName',   body.sortingName)
  if (body.color         !== undefined) pushField('color',         'color',         body.color)
  if (body.country       !== undefined) pushField('country',       'country',       body.country)
  if (body.foundedDate   !== undefined) pushField('foundedDate',   'foundedDate',   body.foundedDate,   false)
  if (body.dissolvedDate !== undefined) pushField('dissolvedDate', 'dissolvedDate', body.dissolvedDate, false)

  if (!setClauses.length) return json({ ok: true, unchanged: true })

  try {
    const [updated] = await runCypher<{
      name: string | null; formalName: string | null; abbreviation: string | null;
      sortingName: string | null; color: string | null; country: string | null;
      foundedDate: string | null; dissolvedDate: string | null;
    }>(env, `
      MATCH (o:Organization {slug: $slug})
      SET ${setClauses.join(', ')}
      RETURN o.canonicalName AS name,
             o.formalName    AS formalName,
             o.abbreviation  AS abbreviation,
             o.sortingName   AS sortingName,
             o.color         AS color,
             o.country       AS country,
             o.foundedDate   AS foundedDate,
             o.dissolvedDate AS dissolvedDate
    `, params2)

    if (!updated) return json({ error: 'Organization not found' }, 404)
    return json({ ok: true, ...updated })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
