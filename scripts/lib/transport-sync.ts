/**
 * Sanity → graph sync of a transport's own fields: name, type, unit, regser (#112).
 * docs/SANITY-SYNC.md ("Transports") has the bridge; this is its field-level form, with
 * a stamp per field on the node as for events and people (`<field>_sha`).
 *
 * Where the graph keeps each field:
 *   name    canonicalName
 *   type    type, type_state, type_sourceRef
 *   regser  regser, regser_state, regser_sourceRef
 *   unit    rawUnit, rawUnit_state, rawUnit_sourceRef — the import's property. The transport
 *           editor writes `unit` instead (functions/api/admin/transport/[slug]); where there
 *           is one, it is the graph's value, and the sync never overwrites it unseen.
 *
 * Values are compared whitespace-tidied (src/utils/tidyText.ts): Sanity has `" 42-7612"`,
 * tabs and double spaces in names. The graph gets the tidied value; the stamp is the hash of it.
 *
 * Per field, against its stamp (`<field>_sha`, the Sanity value last taken in):
 *   unchanged  Sanity still holds what the stamp says: nothing
 *   clean      Sanity changed, the graph still holds the stamped value: apply
 *   already    Sanity changed (or there is no stamp yet) and the graph already holds the new
 *              value: the stamp moves; the value is rewritten only to tidy it
 *   conflict   Sanity changed and the graph value was edited: left alone, listed
 *   kept       no stamp, Sanity unchanged since the import, the graph differs: the graph edit
 *              stays, the stamp moves (a later Sanity change is then a conflict)
 *   review     no stamp, Sanity changed since the import, the graph differs: no baseline to
 *              tell who edited, so left alone, listed (`--accept-review=<slug>,…` applies Sanity's)
 * Graph edits are never overwritten.
 */

import { API, sha, type Doc } from './person-sync.ts'
import { sanMigRef } from './person-rule.ts'
import { tidyText } from '../../src/utils/tidyText.ts'

export const TRANSPORT_FIELDS = ['name', 'type', 'unit', 'regser'] as const
export type TransportFieldName = typeof TRANSPORT_FIELDS[number]

export interface GraphTransport {
  sanityId:        string
  sanityUpdatedAt: string | null
  slug:            string
  canonicalName:   string | null
  type:            string | null
  regser:          string | null
  rawUnit:         string | null
  /** Set by the editor only (the import writes rawUnit). */
  unit:            string | null
  stamps:          Partial<Record<`${TransportFieldName}_sha`, string | null>>
}

export type TransportVerdict = 'clean' | 'already' | 'conflict' | 'kept' | 'review'
export interface FieldVerdict { field: TransportFieldName; verdict: TransportVerdict }

/** The tidied value of a field in Sanity, or '' when it has none. */
export const sanityField = (d: Doc, f: TransportFieldName): string => tidyText(d[f] as string | null | undefined) ?? ''

/** The raw value the graph holds for a field (null when nothing). */
export function graphRaw(g: GraphTransport, f: TransportFieldName): string | null {
  switch (f) {
    case 'name':   return g.canonicalName
    case 'type':   return g.type
    case 'regser': return g.regser
    case 'unit':   return g.unit ?? g.rawUnit
  }
}
export const graphField = (g: GraphTransport, f: TransportFieldName): string => tidyText(graphRaw(g, f)) ?? ''

/** The fields of one transport that need a decision or a stamp. A field Sanity has not changed is left out. */
export function classifyTransport(g: GraphTransport, s: Doc): FieldVerdict[] {
  const out: FieldVerdict[] = []
  const sanityUnchanged = s._updatedAt === g.sanityUpdatedAt
  for (const field of TRANSPORT_FIELDS) {
    const now = sanityField(s, field), graph = graphField(g, field)
    const stamp = g.stamps[`${field}_sha`]
    const push = (verdict: TransportVerdict) => out.push({ field, verdict })

    if (stamp) {
      if (sha(now) === stamp) continue
      if (graph === now) push('already')
      else if (sha(graph) === stamp) push('clean')
      else push('conflict')
      continue
    }
    // No stamp yet: the first run for this field.
    if (graph === now) push('already')
    else push(sanityUnchanged ? 'kept' : 'review')
  }
  return out
}

/** Is the graph's raw value not in its tidied form? (`already` rewrites it only then.) */
export const needsTidy = (g: GraphTransport, f: TransportFieldName): boolean => {
  const raw = graphRaw(g, f)
  return raw !== null && raw !== graphField(g, f)
}

/** The stamps for the fields taken in. */
export const stampsFor = (d: Doc, fields: readonly TransportFieldName[] = TRANSPORT_FIELDS): Record<string, string> =>
  Object.fromEntries(fields.map(f => [`${f}_sha`, sha(sanityField(d, f))]))

/** The graph properties that make a field hold Sanity's value. Null removes a property. */
export function propsFor(d: Doc, field: TransportFieldName): Record<string, string | null> {
  const value = sanityField(d, field) || null
  const claim = (prop: string, sanityProp: string) => ({
    [prop]: value,
    [`${prop}_state`]: value ? 'candidate' : null,
    [`${prop}_sourceRef`]: value ? sanMigRef('transport', d._id, sanityProp) : null,
  })
  switch (field) {
    case 'name':   return { canonicalName: value }
    case 'type':   return claim('type', 'type')
    case 'regser': return claim('regser', 'regser')
    case 'unit':   return claim('rawUnit', 'unit')
  }
}

/** The properties of a transport new in Sanity: the import's rule (round_one.clj), tidied, with stamps. */
export function newTransportProps(d: Doc): Record<string, unknown> {
  const p: Record<string, unknown> = {
    slug: (d.slug as { current?: string } | undefined)?.current ?? '',
    sanityId: d._id, sanityUpdatedAt: d._updatedAt,
    ...stampsFor(d),
  }
  for (const f of TRANSPORT_FIELDS) for (const [k, v] of Object.entries(propsFor(d, f))) if (v !== null) p[k] = v
  const reserve = tidyText(d.reserve as string | undefined)
  if (reserve) Object.assign(p, { reserve, reserve_state: 'candidate', reserve_sourceRef: sanMigRef('transport', d._id, 'reserve') })
  return p
}

/** Sanity's transports, current (not an export). */
export async function fetchSanityTransports(): Promise<Doc[]> {
  const out: Doc[] = []
  let lastId = ''
  for (;;) {
    const url = new URL(API)
    url.searchParams.set('query',
      `*[_type == "transport" && !(_id in path("drafts.**")) && _id > $lastId] | order(_id asc) [0...1000] { _id, _updatedAt, name, type, unit, regser, reserve, slug }`)
    url.searchParams.set('$lastId', JSON.stringify(lastId))
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Sanity ${res.status}`)
    const page = (await res.json() as { result: Doc[] }).result
    out.push(...page)
    if (page.length < 1000) return out
    lastId = page[page.length - 1]._id
  }
}

export const GRAPH_QUERY = `
  MATCH (n:Transport) WHERE n.sanityId IS NOT NULL
  RETURN n.sanityId AS sanityId, n.sanityUpdatedAt AS sanityUpdatedAt, n.slug AS slug,
         n.canonicalName AS canonicalName, n.type AS type, n.regser AS regser, n.rawUnit AS rawUnit, n.unit AS unit,
         {name_sha: n.name_sha, type_sha: n.type_sha, unit_sha: n.unit_sha, regser_sha: n.regser_sha} AS stamps`

/**
 * Apply one batch: properties and stamps, the editor's `unit` dropped where the sync wrote the unit.
 * `at` is null while a field is held for review: sanityUpdatedAt is what tells a stamp-less field
 * that Sanity changed since the import, so it must not move past it.
 */
export const APPLY_QUERY = `
  UNWIND $rows AS row
  MATCH (n:Transport {sanityId: row.id})
  SET n += row.props, n += row.stamps, n.sanityUpdatedAt = coalesce(row.at, n.sanityUpdatedAt)
  FOREACH (_ IN CASE WHEN row.dropUnit THEN [1] ELSE [] END | REMOVE n.unit)
  RETURN count(n) AS n`

export const CREATE_QUERY = `
  UNWIND $rows AS row
  CREATE (n:Transport) SET n = row.props
  RETURN count(n) AS n`
