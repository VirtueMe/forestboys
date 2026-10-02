/**
 * POST /api/neo4j/query — the browser's read access to the graph.
 *
 * Body: { query: string, params?: object } → { rows: object[] }
 *
 * The browser used to connect to Neo4j itself with a "reader" user, whose
 * password ships in the bundle. Aura Free can't create users, so the only
 * user is the admin — it must stay server-side. Here the query runs with the
 * server's credentials in a READ transaction (`Access-Mode: READ`): Neo4j
 * itself refuses any write ("Writing in read access mode not allowed"),
 * whatever the browser sends.
 *
 * Rows come back as plain objects per record — what neo4jQuery() returned
 * from the driver (the app reads no Node or temporal objects).
 *
 * Public, like the site. Bounded: query size, time, and rows.
 */

interface Env {
  NEO4J_URI:       string
  NEO4J_HTTP_URI?: string
  NEO4J_USERNAME:  string
  NEO4J_PASSWORD:  string
}

const MAX_QUERY = 20_000
const MAX_ROWS  = 50_000
const TIMEOUT   = 20_000

function httpUri(env: Env): string {
  if (env.NEO4J_HTTP_URI) return env.NEO4J_HTTP_URI.replace(/\/$/, '')
  const u = env.NEO4J_URI
  if (u.startsWith('neo4j+s://')) return 'https://' + u.slice('neo4j+s://'.length)
  if (u.startsWith('bolt://'))    return 'http://' + u.slice('bolt://'.length).replace(':7687', ':7474')
  return u.replace(/\/$/, '')
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = await request.json<{ query?: unknown; params?: unknown }>().catch(() => null)
  if (!body || typeof body.query !== 'string' || !body.query.trim()) return json({ error: 'query required' }, 400)
  if (body.query.length > MAX_QUERY) return json({ error: 'query too long' }, 413)
  const params = body.params ?? {}
  if (typeof params !== 'object' || Array.isArray(params)) return json({ error: 'params must be an object' }, 400)

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT)
  try {
    const res = await fetch(`${httpUri(env)}/db/neo4j/tx/commit`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Authorization': `Basic ${btoa(`${env.NEO4J_USERNAME}:${env.NEO4J_PASSWORD}`)}`,
        'Content-Type':  'application/json',
        'Accept':        'application/json',
        'Access-Mode':   'READ',
      },
      body: JSON.stringify({ statements: [{ statement: body.query, parameters: params }] }),
    })
    if (!res.ok) return json({ error: `Neo4j HTTP ${res.status}` }, 502)
    const data = await res.json<{
      results: { columns: string[]; data: { row: unknown[] }[] }[]
      errors:  { code: string; message: string }[]
    }>()
    if (data.errors?.length) {
      const e = data.errors[0]
      return json({ error: e.message, code: e.code }, e.code.startsWith('Neo.ClientError') ? 400 : 502)
    }
    const r = data.results[0]
    if (!r) return json({ rows: [] })
    if (r.data.length > MAX_ROWS) return json({ error: `more than ${MAX_ROWS} rows` }, 413)
    const rows = r.data.map(({ row }) => Object.fromEntries(r.columns.map((c, i) => [c, row[i]])))
    return json({ rows })
  } catch (e) {
    return json({ error: (e as Error).name === 'AbortError' ? 'query timed out' : (e as Error).message }, 504)
  } finally {
    clearTimeout(timer)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
