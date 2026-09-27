/**
 * Role scopes — which relation a Role applies to, and the edge that
 * stores it (`role: '<key>'` on the edge). The single source for the
 * scope → edge mapping: usage counts and in-use guards derive from it.
 * The admin UI only knows scope keys + their Norwegian labels.
 *
 * Add a scope here when a new relation grows a `role` property.
 */

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
