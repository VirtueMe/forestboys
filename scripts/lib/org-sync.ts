/**
 * Sanity → graph sync of organizations and districts (#300, part of #156). The same field-level form as the transport and
 * place syncs (scripts/lib/transport-sync.ts, place-sync.ts): a stamp per field on the node (`<field>_sha`, the hash of the
 * Sanity value last taken in), and a graph edit is never overwritten. docs/SANITY-SYNC.md («Organizations and districts»).
 *
 * The import reshaped both, so the compare is against what the import rule made (migration/src/linge/round_one.clj,
 * events.clj), not a raw copy:
 *   organization  (:Organization)              name → canonicalName, sortPrefix, rawName   color → color (hex)
 *   district      (:Unit {type: 'district'})   name → canonicalName
 * An organization's name is `NN-Name` or `Name`: the sort prefix is the number in front, the canonical name the rest.
 *
 * The slug is made once, from the name, and not changed by the sync: a Sanity rename updates the display name and leaves
 * the address alone (events link by `sanityId`; a district Unit has no alias route, so its old address could not be kept).
 *
 * Per field, against its stamp (the verdicts of the place sync):
 *   unchanged  Sanity still holds what the stamp says: nothing
 *   clean      Sanity changed, the graph still holds the stamped value: apply
 *   already    Sanity changed (or there is no stamp yet) and the graph already holds the new value: the stamp moves
 *   conflict   Sanity changed and the graph value was edited: left alone, listed
 *   kept       no stamp, Sanity unchanged since the import, the graph differs: the graph edit stays, the stamp moves
 *   review     no stamp, Sanity changed since the import, the graph differs: no baseline to tell who edited, so left
 *              alone, listed (`--accept-review=<slug>,…` applies Sanity's)
 * With no stamp the baseline export (scripts/lib/baseline.ts) is the baseline where it is the version the graph was
 * imported from, as for places.
 */

import { API, sha, type Doc } from './person-sync.ts'

export const ORG_FIELDS = ['name', 'color'] as const
export type OrgFieldName = typeof ORG_FIELDS[number]

export interface OrgKind {
  /** Sanity's `_type`, and the kind in a sourceRef. */
  key:    'organization' | 'district'
  /** The graph label. */
  label:  'Organization' | 'Unit'
  /** Extra match on the node: a district is a Unit of type district. */
  where:  string
  fields: readonly OrgFieldName[]
}

export const ORGANIZATION: OrgKind = { key: 'organization', label: 'Organization', where: 'true',               fields: ['name', 'color'] }
export const DISTRICT:     OrgKind = { key: 'district',     label: 'Unit',         where: `n.type = 'district'`, fields: ['name'] }

/**
 * Sanity documents the sync does not bring in. The Sanity organization «NOR.I.C.1 Kompani Linge» was made a Unit by the
 * import; the graph no longer pursues that, and what becomes of it is Jan's to decide from the outline proposals.
 */
export const LEFT_TO_JAN: ReadonlyMap<string, string> = new Map([
  ['bc2e9f77-64f5-470e-b743-2b6fbe0663f7', 'Kompani Linge: Jan decides from the outline proposals'],
])

export interface GraphOrg {
  sanityId:        string
  sanityUpdatedAt: string | null
  slug:            string
  canonicalName:   string | null
  sortPrefix:      string | null
  color:           string | null
  stamps:          Partial<Record<`${OrgFieldName}_sha`, string | null>>
}

export type OrgVerdict = 'clean' | 'already' | 'conflict' | 'kept' | 'review'
export interface FieldVerdict { field: OrgFieldName; verdict: OrgVerdict }

/** The import's slug rule (round_one.clj `slugify`): lower case, æ ø å spelled out, anything else but a-z 0-9 a hyphen. */
export function slugify(s: string): string {
  return s.toLowerCase().replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'aa').replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '')
}

/** An organization's name as the import split it (round_one.clj `parse-org-name`): `03-Hæren` → prefix `03`, `Hæren`. */
export function parseOrgName(raw: string): { slug: string; canonical: string; sortPrefix: string | null; raw: string } {
  const m = /^(\d{1,2})-\s*(.*)$/s.exec(raw)
  if (m) { const canonical = m[2].trim(); return { slug: slugify(canonical), canonical, sortPrefix: m[1], raw } }
  return { slug: slugify(raw), canonical: raw, sortPrefix: null, raw }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const sanityName = (d: Doc): string => str(d.name)
const sanityColor = (d: Doc): string => str((d.color as { hex?: unknown } | null | undefined)?.hex)

/** The slug a new node gets: from the organization's canonical name, from a district's trimmed name. */
export const newSlug = (kind: OrgKind, d: Doc): string =>
  kind.key === 'organization' ? parseOrgName(sanityName(d)).slug : slugify(sanityName(d).trim())

/** The node's display name: for an organization the sort prefix and the name, which are compared together. */
export function sanityValue(kind: OrgKind, d: Doc, f: OrgFieldName): string {
  if (f === 'color') return sanityColor(d)
  if (kind.key === 'district') return sanityName(d).trim()
  const p = parseOrgName(sanityName(d))
  return `${p.sortPrefix ?? ''}|${p.canonical}`
}

export function graphValue(kind: OrgKind, g: GraphOrg, f: OrgFieldName): string {
  if (f === 'color') return g.color ?? ''
  if (kind.key === 'district') return (g.canonicalName ?? '').trim()
  return `${g.sortPrefix ?? ''}|${g.canonicalName ?? ''}`
}

/** The fields of one node that need a decision or a stamp. A field Sanity has not changed is left out. */
export function classifyOrg(kind: OrgKind, g: GraphOrg, s: Doc, baseline?: Doc): FieldVerdict[] {
  const out: FieldVerdict[] = []
  const sanityUnchanged = s._updatedAt === g.sanityUpdatedAt
  const base = baseline && baseline._updatedAt === g.sanityUpdatedAt ? baseline : undefined
  for (const field of kind.fields) {
    const now = sanityValue(kind, s, field), graph = graphValue(kind, g, field)
    const stamp = g.stamps[`${field}_sha`]
    const push = (verdict: OrgVerdict) => out.push({ field, verdict })

    if (stamp) {
      if (sha(now) === stamp) continue
      if (graph === now) push('already')
      else if (sha(graph) === stamp) push('clean')
      else push('conflict')
      continue
    }
    if (graph === now) push('already')
    else if (sanityUnchanged) push('kept')
    else if (base) push(graph === sanityValue(kind, base, field) ? 'clean' : 'conflict')
    else push('review')
  }
  return out
}

/** The stamps for the fields taken in. */
export const stampsFor = (kind: OrgKind, d: Doc, fields: readonly OrgFieldName[] = kind.fields): Record<string, string> =>
  Object.fromEntries(fields.map(f => [`${f}_sha`, sha(sanityValue(kind, d, f))]))

/** The node properties that make a field hold Sanity's value; null removes a property. */
export function propsFor(kind: OrgKind, d: Doc, field: OrgFieldName): Record<string, string | null> {
  if (field === 'color') return { color: sanityColor(d) || null }
  if (kind.key === 'district') return { canonicalName: sanityName(d).trim() }
  const p = parseOrgName(sanityName(d))
  return { canonicalName: p.canonical, sortPrefix: p.sortPrefix, rawName: p.raw }
}

export interface OrgRow {
  id:     string
  slug:   string
  props:  Record<string, string | null>
  stamps: Record<string, string>
  /** null while a field is held for review: sanityUpdatedAt must not move past it. */
  at:     string | null
}

/** What to write for one node, from its verdicts. `held` collects what is left alone. */
export function planOrg(kind: OrgKind, g: GraphOrg, s: Doc, verdicts: FieldVerdict[], held: string[]): OrgRow | null {
  const props: Record<string, string | null> = {}
  const taken: OrgFieldName[] = []
  let reviewHeld = false
  for (const { field, verdict } of verdicts) {
    if (verdict === 'conflict') { held.push(`${g.slug}: ${field} (conflict)`); continue }
    if (verdict === 'review') { held.push(`${g.slug}: ${field} (review)`); reviewHeld = true; continue }
    // An empty name in Sanity would blank the page's title: never taken.
    if (field === 'name' && !sanityName(s).trim()) { held.push(`${g.slug}: name (empty in Sanity)`); reviewHeld = true; continue }
    taken.push(field)
    if (verdict === 'kept' || verdict === 'already') continue
    Object.assign(props, propsFor(kind, s, field))
  }
  if (!taken.length) return null
  return { id: g.sanityId, slug: g.slug, props, stamps: stampsFor(kind, s, taken), at: reviewHeld ? null : s._updatedAt }
}

/** The properties of a node new in Sanity: the import's rule with stamps. */
export function newOrgProps(kind: OrgKind, d: Doc): Record<string, unknown> {
  const p: Record<string, unknown> = { slug: newSlug(kind, d), sanityId: d._id, sanityUpdatedAt: d._updatedAt, ...stampsFor(kind, d) }
  if (kind.key === 'district') p.type = 'district'
  for (const f of kind.fields) for (const [k, v] of Object.entries(propsFor(kind, d, f))) if (v !== null) p[k] = v
  return p
}

/** Sanity's documents of one kind, current (not an export). */
export async function fetchSanityOrgs(kind: OrgKind): Promise<Doc[]> {
  const url = new URL(API)
  url.searchParams.set('query', `*[_type == $type && !(_id in path("drafts.**"))] | order(_id asc) { _id, _updatedAt, name, color }`)
  url.searchParams.set('$type', JSON.stringify(kind.key))
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Sanity ${res.status}`)
  return (await res.json() as { result: Doc[] }).result
}

export const graphQuery = (kind: OrgKind) => `
  MATCH (n:\`${kind.label}\`) WHERE n.sanityId IS NOT NULL AND ${kind.where}
  RETURN n.sanityId AS sanityId, n.sanityUpdatedAt AS sanityUpdatedAt, n.slug AS slug,
         n.canonicalName AS canonicalName, n.sortPrefix AS sortPrefix, n.color AS color,
         {name_sha: n.name_sha, color_sha: n.color_sha} AS stamps`

/** Every slug of the label, to keep a new node from taking one that is used. */
export const slugsQuery = (kind: OrgKind) => `MATCH (n:\`${kind.label}\`) RETURN n.slug AS slug`

/**
 * Apply one batch of properties and stamps. `at` is null while a field is held for review: sanityUpdatedAt is what tells a
 * stamp-less field that Sanity changed since the import, so it must not move past it.
 */
export const applyQuery = (kind: OrgKind) => `
  UNWIND $rows AS row
  MATCH (n:\`${kind.label}\` {sanityId: row.id})
  SET n += row.props, n += row.stamps, n.sanityUpdatedAt = coalesce(row.at, n.sanityUpdatedAt)
  RETURN count(n) AS n`

export const createQuery = (kind: OrgKind) => `
  UNWIND $rows AS row
  CREATE (n:\`${kind.label}\`) SET n = row.props
  RETURN count(n) AS n`

/** What a node holds before a write, for the backup. */
export const backupQuery = (kind: OrgKind) => `
  MATCH (n:\`${kind.label}\`) WHERE n.sanityId IN $ids
  RETURN n.sanityId AS sanityId, n.slug AS slug, n.sanityUpdatedAt AS sanityUpdatedAt, properties(n) AS props`
