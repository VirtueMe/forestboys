/**
 * Minimal Neo4j helper for Pages Functions — the Query API
 * (`/db/<database>/query/v2`, Neo4j 5.19+), no neo4j-driver (Worker-compatible).
 *
 * Aura refuses the older transactional endpoint (`/db/neo4j/tx/commit`:
 * "Denied by administrative rules"), and an Aura database is named after
 * its instance, not `neo4j`.
 *
 *   HTTP base  NEO4J_HTTP_URI, else NEO4J_URI coerced:
 *                neo4j+s://X → https://X                       (Aura)
 *                bolt://X    → http://X with :7687 → :7474      (local)
 *   database   NEO4J_DATABASE, else the instance id of an Aura host
 *              (<id>.databases.neo4j.io), else `neo4j`
 *
 * Rows come back as `{ column: value }`. Nodes and relationships in a row are
 * reduced to their property maps — what the older endpoint returned, and what
 * the callers read.
 */

export interface Neo4jEnv {
  NEO4J_HTTP_URI?: string
  NEO4J_URI:       string
  NEO4J_USERNAME:  string
  NEO4J_PASSWORD:  string
  NEO4J_DATABASE?: string
}

export interface CypherStatement {
  statement:   string
  parameters?: Record<string, unknown>
}

export type AccessMode = 'Read' | 'Write'

function resolveHttpUri(env: Neo4jEnv): string {
  if (env.NEO4J_HTTP_URI) return env.NEO4J_HTTP_URI.replace(/\/$/, '')
  const u = env.NEO4J_URI
  if (u.startsWith('neo4j+s://')) return 'https://' + u.slice('neo4j+s://'.length)
  if (u.startsWith('bolt://'))    return 'http://'  + u.slice('bolt://'.length).replace(':7687', ':7474')
  return u.replace(/\/$/, '')
}

export function databaseName(env: Neo4jEnv): string {
  if (env.NEO4J_DATABASE) return env.NEO4J_DATABASE
  const aura = /^[a-z0-9+.-]+:\/\/([a-z0-9]+)\.databases\.neo4j\.io/.exec(env.NEO4J_URI ?? '')
  return aura ? aura[1] : 'neo4j'
}

interface QueryResponse {
  data?:        { fields: string[]; values: unknown[][] }
  errors?:      { code: string; message: string }[]
  transaction?: { id: string }
}

export class Neo4jError extends Error {
  constructor(message: string, readonly code: string) { super(message) }
}

/** Nodes and relationships → their properties, as the older endpoint returned them. */
function plain(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(plain)
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o.elementId === 'string' && o.properties && typeof o.properties === 'object') return plain(o.properties)
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, plain(x)]))
  }
  return v
}

function rows(r: QueryResponse): Record<string, unknown>[] {
  if (!r.data) return []
  const { fields, values } = r.data
  return values.map(row => Object.fromEntries(fields.map((f, i) => [f, plain(row[i])])))
}

async function post(
  env:      Neo4jEnv,
  path:     string,
  body:     unknown,
  affinity?: string | null,
  method = 'POST',
): Promise<{ data: QueryResponse; affinity: string | null }> {
  const headers: Record<string, string> = {
    'Authorization': `Basic ${btoa(`${env.NEO4J_USERNAME}:${env.NEO4J_PASSWORD}`)}`,
    'Content-Type':  'application/json',
    'Accept':        'application/json',
  }
  // A transaction stays on one cluster member: echo the server's affinity header.
  if (affinity) headers['neo4j-cluster-affinity'] = affinity
  const res = await fetch(`${resolveHttpUri(env)}/db/${databaseName(env)}/query/v2${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({})) as QueryResponse
  if (data.errors?.length) throw new Neo4jError(data.errors[0].message, data.errors[0].code)
  if (!res.ok) throw new Neo4jError(`Neo4j HTTP ${res.status}`, `HTTP.${res.status}`)
  return { data, affinity: res.headers.get('neo4j-cluster-affinity') ?? affinity ?? null }
}

/** One statement in its own (auto-commit) transaction. `Read` makes Neo4j refuse any write. */
export async function runCypher<T = Record<string, unknown>>(
  env:        Neo4jEnv,
  statement:  string,
  parameters: Record<string, unknown> = {},
  accessMode: AccessMode = 'Write',
): Promise<T[]> {
  const { data } = await post(env, '', { statement, parameters, accessMode })
  return rows(data) as T[]
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
  if (!statements.length) return []
  const [first, ...rest] = statements
  const opened = await post(env, '/tx', { statement: first.statement, parameters: first.parameters ?? {} })
  const id = opened.data.transaction?.id
  if (!id) throw new Neo4jError('Neo4j did not open a transaction', 'Tx.NoId')
  let affinity = opened.affinity
  const out = [rows(opened.data)]
  try {
    for (const s of rest) {
      const r = await post(env, `/tx/${id}`, { statement: s.statement, parameters: s.parameters ?? {} }, affinity)
      affinity = r.affinity
      out.push(rows(r.data))
    }
    await post(env, `/tx/${id}/commit`, {}, affinity)
    return out
  } catch (e) {
    await post(env, `/tx/${id}`, undefined, affinity, 'DELETE').catch(() => {})
    throw e
  }
}
