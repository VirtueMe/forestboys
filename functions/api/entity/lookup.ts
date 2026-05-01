/**
 * POST /api/entity/lookup — bot-facing batch existence + name resolution.
 *
 * Body: { ids: ['Person:foo', 'Unit:bar', ...] }
 * Returns: {
 *   found:   [{ id: 'Person:foo', name: 'Foo Bar' }, ...],
 *   missing: ['Unit:bar', ...],
 * }
 *
 * Used by the bot to verify that an entity it wants to reference (in
 * `add-edge` ops or in prose) actually exists in the live graph before
 * emitting it. Lighter than `/api/entity/<kind>/<slug>/context` when
 * all you need is "does it exist + what's its display name".
 *
 * Auth: `Authorization: Bearer ${BOT_INGEST_SECRET}` — same as the
 * context endpoint.
 */

import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'

interface Env extends Neo4jEnv {
  BOT_INGEST_SECRET: string
}

const ENTITY_KINDS = new Set([
  'Person', 'Unit', 'Station', 'Transport',
  'Operation', 'Incident', 'Location', 'Outline', 'Organization',
])
const ENTITY_ID_RE = /^([A-Za-z]+):([a-z0-9-]+)$/

interface Body { ids?: unknown }

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.BOT_INGEST_SECRET) return json({ error: 'BOT_INGEST_SECRET not configured' }, 500)
  const auth = request.headers.get('Authorization') || ''
  if (!verifyBearer(auth, env.BOT_INGEST_SECRET)) return json({ error: 'Unauthorized' }, 401)

  const body = await request.json<Body>().catch(() => null)
  if (!body || !Array.isArray(body.ids)) return json({ error: 'ids must be an array of <Kind>:<slug> strings' }, 400)

  const byKind: Record<string, string[]> = {}
  const malformed: string[] = []
  const idToKindSlug: Record<string, { kind: string; slug: string }> = {}
  for (const raw of body.ids) {
    if (typeof raw !== 'string') { malformed.push(String(raw)); continue }
    const m = raw.match(ENTITY_ID_RE)
    if (!m || !ENTITY_KINDS.has(m[1])) { malformed.push(raw); continue }
    const [, kind, slug] = m
    idToKindSlug[raw] = { kind, slug }
    ;(byKind[kind] ||= []).push(slug)
  }

  try {
    const found: { id: string; name: string }[] = []
    const seen = new Set<string>()
    for (const [kind, slugs] of Object.entries(byKind)) {
      const rows = await runCypher<{ slug: string; name: string | null }>(
        env,
        `MATCH (n:\`${kind}\`) WHERE n.slug IN $slugs
         RETURN n.slug AS slug, coalesce(n.canonicalName, n.title, n.name) AS name`,
        { slugs },
      )
      for (const r of rows) {
        const id = `${kind}:${r.slug}`
        seen.add(id)
        found.push({ id, name: r.name ?? r.slug })
      }
    }
    const missing = Object.keys(idToKindSlug).filter((id) => !seen.has(id))

    // For each missing id, attempt a fuzzy match: tokenize the slug
    // (hyphen-split) and find the same-kind entity whose canonicalName
    // matches the most tokens. Returns a soft suggestion for the
    // caller — bot can warn Jan, runner can post a manifest note.
    const suggestions: Record<string, { id: string; name: string; hits: number }> = {}
    for (const id of missing) {
      const { kind, slug } = idToKindSlug[id]
      const tokens = slug.split('-').filter((t) => t.length >= 3).map((t) => t.toLowerCase())
      if (tokens.length === 0) continue
      const rows = await runCypher<{ slug: string; name: string | null; hits: number }>(
        env,
        `MATCH (n:\`${kind}\`)
         WITH n, coalesce(n.canonicalName, n.title, n.name) AS name
         WHERE name IS NOT NULL
         WITH n, name, [t IN $tokens WHERE toLower(name) CONTAINS t] AS matches
         WHERE size(matches) > 0
         RETURN n.slug AS slug, name AS name, size(matches) AS hits
         ORDER BY hits DESC
         LIMIT 1`,
        { tokens },
      )
      const r = rows[0]
      if (r) suggestions[id] = { id: `${kind}:${r.slug}`, name: r.name ?? r.slug, hits: r.hits }
    }

    return json({ found, missing, malformed, suggestions })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function verifyBearer(header: string, expected: string): boolean {
  const prefix = 'Bearer '
  if (!header.startsWith(prefix)) return false
  const got = header.slice(prefix.length)
  if (got.length !== expected.length) return false
  let mismatch = 0
  for (let i = 0; i < got.length; i++) mismatch |= got.charCodeAt(i) ^ expected.charCodeAt(i)
  return mismatch === 0
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
