/**
 * POST /api/review-item — approve or reject a ReviewItem node in Neo4j.
 *
 * Body: { id: string, status: "approved" | "rejected" }
 *
 * Neo4j credentials stay server-side — never exposed to the browser.
 * Will require session auth once the login system is in place.
 *
 * Uses the Neo4j HTTP API (no neo4j-driver — Cloudflare Workers compatible).
 */

interface Env {
  NEO4J_URI:       string   // neo4j+s://your-instance.databases.neo4j.io
  NEO4J_USERNAME:  string
  NEO4J_PASSWORD:  string
}

const ALLOWED_STATUSES = new Set(['approved', 'rejected'])

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // ── Parse body ───────────────────────────────────────────────────────────────
  let body: { id?: string; status?: string }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const { id, status } = body
  if (!id || typeof id !== 'string') return json({ error: 'Missing id' }, 400)
  if (!status || !ALLOWED_STATUSES.has(status)) return json({ error: 'status must be "approved" or "rejected"' }, 400)

  // ── Run Cypher via Neo4j HTTP API ────────────────────────────────────────────
  const reviewedAt = new Date().toISOString().slice(0, 10)

  const neo4jUrl = `${env.NEO4J_URI.replace('neo4j+s://', 'https://')}/db/neo4j/tx/commit`
  const auth = btoa(`${env.NEO4J_USERNAME}:${env.NEO4J_PASSWORD}`)

  const neo4jRes = await fetch(neo4jUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
    },
    body: JSON.stringify({
      statements: [{
        statement:  `MATCH (ri:ReviewItem {id: $id})
                     SET ri.status     = $status,
                         ri.reviewedAt = $reviewedAt
                     RETURN ri.id AS id`,
        parameters: { id, status, reviewedAt },
      }],
    }),
  })

  if (!neo4jRes.ok) {
    return json({ error: `Neo4j error: ${neo4jRes.status}` }, 502)
  }

  const result = await neo4jRes.json()
  if (result.errors?.length) {
    return json({ error: result.errors[0].message }, 502)
  }

  return json({ ok: true, id, status, reviewedAt })
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
