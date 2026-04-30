/**
 * Minimal Neo4j HTTP-API helper for Pages Functions.
 * Uses the transactional Cypher endpoint — no neo4j-driver (Worker-compatible).
 *
 * NEO4J_HTTP_URI takes precedence. Otherwise NEO4J_URI is coerced:
 *   neo4j+s://X → https://X     (Aura)
 *   bolt://X    → http://X.replace(:7687, :7474)   (local)
 */

export interface Neo4jEnv {
  NEO4J_HTTP_URI?: string
  NEO4J_URI:       string
  NEO4J_USERNAME:  string
  NEO4J_PASSWORD:  string
}

function resolveHttpUri(env: Neo4jEnv): string {
  if (env.NEO4J_HTTP_URI) return env.NEO4J_HTTP_URI.replace(/\/$/, '')
  const u = env.NEO4J_URI
  if (u.startsWith('neo4j+s://')) return 'https://' + u.slice('neo4j+s://'.length)
  if (u.startsWith('bolt://'))    return 'http://'  + u.slice('bolt://'.length).replace(':7687', ':7474')
  return u.replace(/\/$/, '')
}

export interface CypherStatement {
  statement:   string
  parameters?: Record<string, unknown>
}

export async function runCypher<T = Record<string, unknown>>(
  env:        Neo4jEnv,
  statement:  string,
  parameters: Record<string, unknown> = {},
): Promise<T[]> {
  const url  = `${resolveHttpUri(env)}/db/neo4j/tx/commit`
  const auth = btoa(`${env.NEO4J_USERNAME}:${env.NEO4J_PASSWORD}`)

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
    },
    body: JSON.stringify({ statements: [{ statement, parameters }] }),
  })

  if (!res.ok) throw new Error(`Neo4j HTTP ${res.status}`)

  interface Body {
    results: { columns: string[]; data: { row: unknown[] }[] }[]
    errors:  { code: string; message: string }[]
  }
  const data: Body = await res.json()
  if (data.errors?.length) throw new Error(data.errors[0].message)

  const r = data.results[0]
  if (!r) return []
  return r.data.map(({ row }) => {
    const obj: Record<string, unknown> = {}
    r.columns.forEach((col, i) => { obj[col] = row[i] })
    return obj as T
  })
}

/**
 * Run multiple Cypher statements as one atomic transaction.
 * If any statement errors, the whole transaction rolls back and the
 * function throws — caller can rely on all-or-nothing semantics, which
 * is what proposal-accept relies on for per-entity apply atomicity.
 *
 * Returns the rows for each statement in input order.
 */
export async function runCypherTx(
  env:        Neo4jEnv,
  statements: CypherStatement[],
): Promise<Record<string, unknown>[][]> {
  const url  = `${resolveHttpUri(env)}/db/neo4j/tx/commit`
  const auth = btoa(`${env.NEO4J_USERNAME}:${env.NEO4J_PASSWORD}`)

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
    },
    body: JSON.stringify({ statements }),
  })

  if (!res.ok) throw new Error(`Neo4j HTTP ${res.status}`)

  interface Body {
    results: { columns: string[]; data: { row: unknown[] }[] }[]
    errors:  { code: string; message: string }[]
  }
  const data: Body = await res.json()
  if (data.errors?.length) throw new Error(data.errors[0].message)

  return data.results.map((r) =>
    r.data.map(({ row }) => {
      const obj: Record<string, unknown> = {}
      r.columns.forEach((col, i) => { obj[col] = row[i] })
      return obj
    }),
  )
}
