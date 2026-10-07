/**
 * GET /api/admin/outline/:slug/version — the outline's version: the hash of its text, what the last fully
 * accepted bundle was made from, and where that leaves it (new, absorbed or stale). The admin's «request a
 * bundle» reads the hash here, so the revision the bot is given is the one of the text it will read (#157).
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { readOutlineVersion } from '~/_lib/outline-version.ts'
import type { Neo4jEnv } from '~/_lib/neo4j.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

const SLUG_RE = /^[a-z0-9-]+$/

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const slug = String(params.slug)
  if (!SLUG_RE.test(slug)) return json({ error: `Invalid slug: ${slug}` }, 400)

  try {
    const version = await readOutlineVersion(env, slug)
    if (!version) return json({ error: `Outline:${slug} not found` }, 404)
    return json(version)
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}
