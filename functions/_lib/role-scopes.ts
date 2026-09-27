/**
 * Role scopes — which relation a Role applies to, and the edge that
 * stores it (`role: '<key>'` on the edge). The single source for the
 * scope → edge mapping: usage counts and in-use guards derive from it.
 * The admin UI only knows scope keys + their Norwegian labels.
 *
 * Add a scope here when a new relation grows a `role` property.
 */

import { runCypher, type Neo4jEnv } from './neo4j.ts'

export const ROLE_SCOPE_EDGES: Record<string, string> = {
  'membership': 'MEMBER_OF',     // Person → Unit / Organization
  'part-of':    'PART_OF',       // Unit → Organization
  'stationed':  'STATIONED_AT',  // Person → Location / Station
  'crew':       'CREW_OF',       // Person → Transport
}

export const ROLE_SCOPES = Object.keys(ROLE_SCOPE_EDGES)

export const KEY_RE = /^[a-z0-9-]+$/

/**
 * Cypher map expression: scope → number of edges of that scope's type
 * whose `role` equals `keyExpr` (a Cypher expression, e.g. `r.key`).
 */
export function usageCypher(keyExpr: string): string {
  const parts = Object.entries(ROLE_SCOPE_EDGES).map(([scope, edge]) =>
    `\`${scope}\`: COUNT { ()-[x:${edge}]->() WHERE x.role = ${keyExpr} }`,
  )
  return `{ ${parts.join(', ')} }`
}

/** Scopes must be a non-empty list of known scope keys, deduplicated. */
export function parseScopes(v: unknown): { list: string[] } | { error: string } {
  if (!Array.isArray(v) || !v.length) return { error: 'Velg minst én gruppe' }
  const list: string[] = []
  for (const s of v) {
    if (typeof s !== 'string' || !ROLE_SCOPES.includes(s)) return { error: `Ukjent gruppe: ${JSON.stringify(s)}` }
    if (!list.includes(s)) list.push(s)
  }
  return { list }
}

/**
 * Validates `role` values on a batch of edges against the Role nodes of
 * one scope. Returns the first value that isn't a string key offered in
 * that scope, or null when all are fine (null / undefined roles are
 * allowed — "no role"). One query per batch.
 */
export async function findInvalidRole(env: Neo4jEnv, scope: string, values: unknown[]): Promise<string | null> {
  const given = values.filter(v => v !== null && v !== undefined)
  if (!given.length) return null
  const rows = await runCypher<{ key: string }>(env,
    `MATCH (r:Role) WHERE $scope IN r.scopes RETURN r.key AS key`, { scope })
  const allowed = new Set(rows.map(r => r.key))
  const bad = given.find(v => typeof v !== 'string' || !allowed.has(v))
  return bad === undefined ? null : JSON.stringify(bad)
}
