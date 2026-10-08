/**
 * POST /api/review-item — approve or reject a ReviewItem node in Neo4j.
 *
 * Body: { id: string, status: "approved" | "rejected" }
 *
 * Neo4j credentials stay server-side — never exposed to the browser.
 * Will require session auth once the login system is in place.
 *
 * Uses the Neo4j Query API through the shared helper (no neo4j-driver — Cloudflare Workers compatible). Aura refuses
 * the older transactional endpoint this once called (#176).
 */

import { runCypher } from '~/_lib/neo4j.ts'

interface Env {
  NEO4J_URI: string // neo4j+s://your-instance.databases.neo4j.io
  NEO4J_USERNAME: string
  NEO4J_PASSWORD: string
  NEO4J_HTTP_URI?: string
  NEO4J_DATABASE?: string
}

const ALLOWED_STATUSES = new Set(['approved', 'rejected'])

interface Body {
  id?: string
  status?: string
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // ── Parse body ───────────────────────────────────────────────────────────────
  const body: Body | null = await request.json<Body>().catch(() => null)

  if (!body) {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const { id, status } = body

  if (!id || typeof id !== 'string') return json({ error: 'Missing id' }, 400)
  if (!status || !ALLOWED_STATUSES.has(status)) return json({ error: 'status must be "approved" or "rejected"' }, 400)

  // ── Run Cypher via the Neo4j Query API ───────────────────────────────────────
  const reviewedAt = new Date().toISOString().slice(0, 10)

  try {
    await runCypher(
      env,
      `MATCH (ri:ReviewItem {id: $id})
       SET ri.status     = $status,
           ri.reviewedAt = $reviewedAt
       RETURN ri.id AS id`,
      { id, status, reviewedAt },
    )
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }

  return json({ ok: true, id, status, reviewedAt })
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
