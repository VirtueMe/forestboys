/**
 * PATCH /api/admin/event/:slug — update scalar fields on an Incident or
 * Operation. The endpoint is kind-agnostic: body carries { name, date,
 * slug } and the server routes `name` to `title` (Incident) or
 * `codeName` (Operation) based on the node's label.
 *
 * Body:
 *   { name?: string, date?: string | null, slug?: string }
 *
 * Slug rename: validates shape + collision against any other Incident/
 * Operation. Edges survive (Neo4j keys edges by node identity, not
 * property). Returns the new slug so the client can navigate.
 *
 * Response: { name, date, slug, kind }
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'
import { invalidateSitemap, type SitemapBinding } from '~/_lib/sitemap.ts'

interface Env extends Neo4jEnv, SitemapBinding {
  SESSION_SECRET: string
}

interface Body {
  name?: string
  date?: string | null
  slug?: string
}

const SLUG_RE = /^[a-z0-9-]+$/

function isDateOrNull(v: unknown): v is string | null {
  if (v === null || v === undefined) return true
  return typeof v === 'string' && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(v)
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params, waitUntil }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const slug = String(params.slug)
  const body = await request.json<Body>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)

  if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) {
    return json({ error: 'name must be a non-empty string' }, 400)
  }
  if (body.date !== undefined && !isDateOrNull(body.date)) {
    return json({ error: `Bad date: ${String(body.date)}` }, 400)
  }
  if (body.slug !== undefined) {
    if (typeof body.slug !== 'string' || !SLUG_RE.test(body.slug)) {
      return json({ error: 'slug må være små bokstaver, tall og bindestrek' }, 400)
    }
    if (body.slug === 'new') return json({ error: 'slug "new" er reservert' }, 400)
  }

  try {
    const [current] = await runCypher<{ kind: 'incident' | 'operation' | null }>(env, `
      MATCH (n {slug: $slug})
      WHERE n:Incident OR n:Operation
      RETURN CASE WHEN 'Operation' IN labels(n) THEN 'operation' ELSE 'incident' END AS kind
    `, { slug })
    if (!current?.kind) return json({ error: 'Node not found or not an Incident/Operation' }, 404)

    // Slug collision check (skip if unchanged).
    if (body.slug !== undefined && body.slug !== slug) {
      const [hit] = await runCypher<{ exists: boolean }>(env, `
        OPTIONAL MATCH (n {slug: $newSlug})
        WHERE n:Incident OR n:Operation
        RETURN n IS NOT NULL AS exists
      `, { newSlug: body.slug })
      if (hit?.exists) return json({ error: `Slug finnes allerede: ${body.slug}` }, 409)
    }

    const nameProp = current.kind === 'operation' ? 'codeName' : 'title'
    const setClauses: string[] = []
    const params2: Record<string, unknown> = { slug }
    if (body.name !== undefined) { setClauses.push(`n.${nameProp} = $name`); params2.name = body.name.trim() }
    if (body.date !== undefined) { setClauses.push(`n.date = $date`);      params2.date = body.date }
    if (body.slug !== undefined && body.slug !== slug) {
      setClauses.push(`n.slug = $newSlug`); params2.newSlug = body.slug
    }

    if (!setClauses.length) return json({ ok: true, kind: current.kind, unchanged: true })

    const [updated] = await runCypher<{ slug: string; name: string | null; date: string | null }>(env, `
      MATCH (n {slug: $slug})
      WHERE n:Incident OR n:Operation
      SET ${setClauses.join(', ')}
      RETURN n.slug AS slug, n.${nameProp} AS name, n.date AS date
    `, params2)

    // The old address goes and the new one comes (#220).
    if (body.slug !== undefined && body.slug !== slug) waitUntil(invalidateSitemap(env))

    return json({
      ok:   true,
      kind: current.kind,
      slug: updated?.slug ?? slug,
      name: updated?.name ?? null,
      date: updated?.date ?? null,
    })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
