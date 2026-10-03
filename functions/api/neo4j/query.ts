/**
 * POST /api/neo4j/query — the browser's read access to the graph.
 *
 * Body: { query: string, params?: object } → { rows: object[] }
 *
 * The browser used to connect to Neo4j itself with a "reader" user, whose
 * password ships in the bundle. Aura Free can't create users, so the only
 * user is the admin — it must stay server-side. Here the query runs with the
 * server's credentials in a read transaction (Query API `accessMode: Read`,
 * functions/_lib/neo4j.ts): Neo4j itself refuses any write ("Writing in read
 * access mode not allowed"), whatever the browser sends.
 *
 * Rows come back as plain objects per record — what neo4jQuery() returned
 * from the driver (the app reads no Node or temporal objects).
 *
 * Public, like the site. Bounded: query size, time, and rows.
 */

import { runCypher, Neo4jError, type Neo4jEnv } from '~/_lib/neo4j.ts'

const MAX_QUERY = 20_000
const MAX_ROWS  = 50_000
const TIMEOUT   = 20_000

export const onRequestPost: PagesFunction<Neo4jEnv> = async ({ request, env }) => {
  // Cloudflare keeps separate Production and Preview variables — say which is missing.
  const missing = (['NEO4J_URI', 'NEO4J_USERNAME', 'NEO4J_PASSWORD'] as const).filter(k => !env[k])
  if (missing.length) return json({ error: `Neo4j is not configured in this environment (${missing.join(', ')} missing)` }, 500)

  const body = await request.json<{ query?: unknown; params?: unknown }>().catch(() => null)
  if (!body || typeof body.query !== 'string' || !body.query.trim()) return json({ error: 'query required' }, 400)
  if (body.query.length > MAX_QUERY) return json({ error: 'query too long' }, 413)
  const params = body.params ?? {}
  if (typeof params !== 'object' || Array.isArray(params)) return json({ error: 'params must be an object' }, 400)

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const rows = await Promise.race([
      runCypher(env, body.query, params as Record<string, unknown>, 'Read'),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('query timed out')), TIMEOUT) }),
    ])
    if (rows.length > MAX_ROWS) return json({ error: `more than ${MAX_ROWS} rows` }, 413)
    return json({ rows })
  } catch (e) {
    if (e instanceof Neo4jError) return json({ error: e.message, code: e.code }, e.code.startsWith('Neo.ClientError') ? 400 : 502)
    const msg = (e as Error).message
    return json({ error: msg }, msg === 'query timed out' ? 504 : 502)
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
