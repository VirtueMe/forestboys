/**
 * useRoles — the Role vocabulary (docs/ROLES.md) for display.
 *
 * Loads every :Role once per session (a few dozen at most) with its
 * name, description text and cited sources, and shares the result
 * across all RoleLabel instances. Admin edits call `invalidateRoles()`
 * so the next label render picks up the change.
 */
import { ref } from 'vue'
import { neo4jQuery } from './useNeo4j.ts'

export interface RoleInfo {
  key:       string
  name:      string
  /** Portable Text blocks per description section, in order. */
  sections:  string[]
  /** Source ids cited by the description (CITES + SOURCED_FROM). */
  sourceIds: string[]
}

const roles = ref<Map<string, RoleInfo>>(new Map())
let loading: Promise<void> | null = null

async function load(): Promise<void> {
  const rows = await neo4jQuery<RoleInfo>(`
    MATCH (r:Role)
    OPTIONAL MATCH (r)-[:HAS_CONTENT]->(d:Description)
    OPTIONAL MATCH (d)-[:CITES|SOURCED_FROM]->(s:Source)
    WITH r, d, collect(DISTINCT s.id) AS ids
    ORDER BY coalesce(d.order, 1)
    WITH r, [x IN collect(d.content) WHERE x IS NOT NULL] AS sections,
         reduce(acc = [], l IN collect(ids) | acc + l) AS allIds
    RETURN r.key AS key, r.name AS name, sections,
           reduce(acc = [], i IN allIds | CASE WHEN i IN acc THEN acc ELSE acc + i END) AS sourceIds
  `)
  roles.value = new Map(rows.map(r => [r.key, r]))
}

/** Starts (or reuses) the one-time load. Safe to call from every label. */
export function ensureRoles(): Promise<void> {
  loading ??= load().catch((e: unknown) => {
    console.error('[useRoles] load failed:', e)
    loading = null
  })
  return loading
}

export function invalidateRoles(): void {
  loading = null
  void ensureRoles()
}

export function useRoles() {
  void ensureRoles()
  return { roles }
}
