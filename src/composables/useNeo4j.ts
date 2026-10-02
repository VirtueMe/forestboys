/**
 * Read-only graph queries from the browser.
 *
 * Runs through POST /api/neo4j/query — a Pages Function that holds the
 * credentials and executes in a READ transaction, so Neo4j refuses any
 * write. The browser has no database credentials (Aura Free has a single,
 * admin user — it can't ship in the bundle).
 *
 * Writes (editors, review approve/reject) go through the /api/admin/*
 * Pages Functions.
 */

/** T describes the rows the query returns — as the driver's generic did, it is not checked. */
export async function neo4jQuery<T = Record<string, unknown>>(
  cypher: string,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  const res = await fetch('/api/neo4j/query', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ query: cypher, params }),
  })
  const body = await res.json().catch(() => ({})) as { rows?: T[]; error?: string }
  if (!res.ok || !body.rows) throw new Error(body.error ?? `Neo4j query failed (HTTP ${res.status})`)
  return body.rows
}
