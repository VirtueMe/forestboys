/**
 * useRoles — the Role vocabulary (docs/ROLES.md) for display and editing.
 *
 * Loads every :Role once per session (a few dozen at most) with its name,
 * scopes, description and cited sources, and shares the result across all
 * RoleLabel instances and role pickers. Admin edits call
 * `invalidateRoles()` so the next render picks up the change.
 */
import { ref, computed, type Ref } from 'vue'
import { neo4jQuery } from './useNeo4j.ts'
import { blocksToHtml, blocksToText } from '@/utils/portableText.ts'

export interface RoleInfo {
  key:       string
  name:      string
  scopes:    string[]
  /** Links with this role are shown under «Har deltatt på», not «Stasjonert på». */
  attended:  boolean
  /** Description rendered to HTML ('' when none). */
  html:      string
  /** Description as plain text ('' when none) — hover title, help text. */
  text:      string
  /** Source ids cited by the description (CITES + SOURCED_FROM). */
  sourceIds: string[]
}

interface RoleRow {
  key:       string
  name:      string
  scopes:    string[] | null
  attended:  boolean | null
  sections:  string[]
  sourceIds: string[]
}

const roles = ref<Map<string, RoleInfo>>(new Map())
let loading: Promise<void> | null = null

type Blocks = Parameters<typeof blocksToHtml>[0]
function parseSections(sections: string[]): Blocks[] {
  return sections.flatMap((c) => {
    try { return [JSON.parse(c) as Blocks] } catch { return [] }
  })
}

async function load(): Promise<void> {
  const rows = await neo4jQuery<RoleRow>(`
    MATCH (r:Role)
    OPTIONAL MATCH (r)-[:HAS_CONTENT]->(d:Description)
    OPTIONAL MATCH (d)-[:CITES|SOURCED_FROM]->(s:Source)
    WITH r, d, collect(DISTINCT s.id) AS ids
    ORDER BY coalesce(d.order, 1)
    WITH r, [x IN collect(d.content) WHERE x IS NOT NULL] AS sections,
         reduce(acc = [], l IN collect(ids) | acc + l) AS allIds
    RETURN r.key AS key, r.name AS name, r.scopes AS scopes, r.attended AS attended, sections,
           reduce(acc = [], i IN allIds | CASE WHEN i IN acc THEN acc ELSE acc + i END) AS sourceIds
  `)
  roles.value = new Map(rows.map((r) => {
    const blocks = parseSections(r.sections)
    return [r.key, {
      key:       r.key,
      name:      r.name,
      scopes:    r.scopes ?? [],
      attended:  r.attended ?? false,
      html:      blocks.map(b => blocksToHtml(b)).join(''),
      text:      blocks.map(b => blocksToText(b)).join(' ').trim(),
      sourceIds: r.sourceIds,
    }]
  }))
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

/** Roles offered for one scope (e.g. 'membership'), sorted by name. */
export function useRoleOptions(scope: Ref<string | null | undefined>) {
  const { roles } = useRoles()
  return computed<RoleInfo[]>(() => {
    const s = scope.value
    if (!s) return []
    return [...roles.value.values()]
      .filter(r => r.scopes.includes(s))
      .sort((a, b) => a.name.localeCompare(b.name, 'nb'))
  })
}
