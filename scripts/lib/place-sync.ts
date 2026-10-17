/**
 * Sanity → graph sync of a place's own fields, for locations (#296) and stations (#297), parts of #155. The same field-level
 * form as the transport sync (#112, scripts/lib/transport-sync.ts): a stamp per field on the node (`<field>_sha`, the hash
 * of the Sanity value last taken in), and a graph edit is never overwritten. docs/SANITY-SYNC.md («Locations and stations»).
 *
 * Where the graph keeps each field:
 *   name         canonicalName                                       (Sanity `title`)
 *   coordinates  lat, lng, lat_state, lng_state, lat_sourceRef, lng_sourceRef
 *   type         type, type_state, type_sourceRef                   (stations only)
 *   gallery      (n)-[:HAS_IMAGE {order}]->(:Source {id: 'img:sanity:<asset>'}), the Sanity-CDN images
 *   slug         slug; a rename keeps the old slug as a SlugAlias (#96) and the page's description id follows it
 *
 * Values are compared in one form: names and types whitespace-tidied (src/utils/tidyText.ts: the graph has `"Airfield "`),
 * coordinates as `lat,lng` to 6 decimals (Sanity's `alt` is not kept), a gallery as its image assets in order.
 *
 * Per field, against its stamp:
 *   unchanged  Sanity still holds what the stamp says: nothing
 *   clean      Sanity changed, the graph still holds the stamped value: apply
 *   already    Sanity changed (or there is no stamp yet) and the graph already holds the new value: the stamp moves; a
 *              name or type is rewritten only to tidy it
 *   conflict   Sanity changed and the graph value was edited: left alone, listed
 *   kept       no stamp, Sanity unchanged since the import, the graph differs: the graph edit stays, the stamp moves
 *   review     no stamp, Sanity changed since the import, the graph differs: no baseline to tell who edited, so left
 *              alone, listed (`--accept-review=<slug>,…` applies Sanity's)
 *
 * With no stamp, the baseline export (scripts/lib/baseline.ts) is the baseline where it is the version the graph was
 * imported from (same `_updatedAt` as the node's `sanityUpdatedAt`): a graph still holding its value was not edited, so
 * Sanity's change is clean; a graph holding something else was edited too, so it is a conflict. The file is local; once
 * a field is stamped, the stamp is its baseline.
 */

import { API, sha, type Doc } from './person-sync.ts'
import { imageSources, sanMigRef, type ImageSource } from './person-rule.ts'
import { tidyText } from '../../src/utils/tidyText.ts'

export const PLACE_FIELDS = ['name', 'coordinates', 'type', 'gallery', 'slug'] as const
export type PlaceFieldName = typeof PLACE_FIELDS[number]

export interface PlaceKind {
  /** Sanity's `_type`, and the kind in a sourceRef and a description id. */
  key:    'location' | 'station'
  label:  'Location' | 'Station'
  /** The address space of the page, for its slug aliases (src/utils/slugResolver.ts KIND_ROUTES). */
  route:  string
  fields: readonly PlaceFieldName[]
}

export const LOCATION: PlaceKind = { key: 'location', label: 'Location', route: '/map/',     fields: ['name', 'coordinates', 'gallery', 'slug'] }
export const STATION:  PlaceKind = { key: 'station',  label: 'Station',  route: '/station/', fields: ['name', 'coordinates', 'type', 'gallery', 'slug'] }

export interface GraphPlace {
  sanityId:        string
  sanityUpdatedAt: string | null
  slug:            string
  canonicalName:   string | null
  lat:             number | null
  lng:             number | null
  type:            string | null
  /** The Sanity-CDN images, in their order. */
  imageRefs:       string[]
  stamps:          Partial<Record<`${PlaceFieldName}_sha`, string | null>>
}

export type PlaceVerdict = 'clean' | 'already' | 'conflict' | 'kept' | 'review'
export interface FieldVerdict { field: PlaceFieldName; verdict: PlaceVerdict }

const round6 = (n: number) => Math.round(n * 1e6) / 1e6
const num = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null

/** Coordinates in the one form both sides are compared in, or '' when there are none. */
export function coordinatesKey(lat: unknown, lng: unknown): string {
  const a = num(lat), b = num(lng)
  return a === null || b === null ? '' : `${round6(a)},${round6(b)}`
}

const sanityCoordinates = (d: Doc) => d.coordinates as { lat?: unknown; lng?: unknown } | null | undefined
export const sanitySlug = (d: Doc): string => (d.slug as { current?: string } | undefined)?.current?.trim() ?? ''
export const sanityImages = (d: Doc): ImageSource[] => imageSources(d.gallery)

/** A field's value in Sanity, in the compared form ('' when it has none). */
export function sanityValue(d: Doc, f: PlaceFieldName): string {
  switch (f) {
    case 'name':        return tidyText(d.title as string | null | undefined) ?? ''
    case 'coordinates': return coordinatesKey(sanityCoordinates(d)?.lat, sanityCoordinates(d)?.lng)
    case 'type':        return tidyText(d.type as string | null | undefined) ?? ''
    case 'gallery':     return sanityImages(d).map(i => i.assetRef).join(' ')
    case 'slug':        return sanitySlug(d)
  }
}

/** A field's value in the graph, in the compared form. */
export function graphValue(g: GraphPlace, f: PlaceFieldName): string {
  switch (f) {
    case 'name':        return tidyText(g.canonicalName) ?? ''
    case 'coordinates': return coordinatesKey(g.lat, g.lng)
    case 'type':        return tidyText(g.type) ?? ''
    case 'gallery':     return g.imageRefs.join(' ')
    case 'slug':        return g.slug
  }
}

/** The fields of one place that need a decision or a stamp. A field Sanity has not changed is left out. */
export function classifyPlace(kind: PlaceKind, g: GraphPlace, s: Doc, baseline?: Doc): FieldVerdict[] {
  const out: FieldVerdict[] = []
  const sanityUnchanged = s._updatedAt === g.sanityUpdatedAt
  const base = baseline && baseline._updatedAt === g.sanityUpdatedAt ? baseline : undefined
  for (const field of kind.fields) {
    const now = sanityValue(s, field), graph = graphValue(g, field)
    const stamp = g.stamps[`${field}_sha`]
    const push = (verdict: PlaceVerdict) => out.push({ field, verdict })

    if (stamp) {
      if (sha(now) === stamp) continue
      if (graph === now) push('already')
      else if (sha(graph) === stamp) push('clean')
      else push('conflict')
      continue
    }
    if (graph === now) push('already')
    else if (sanityUnchanged) push('kept')
    else if (base) push(graph === sanityValue(base, field) ? 'clean' : 'conflict')
    else push('review')
  }
  return out
}

/** Is a name or type not held in its tidied form? (`already` rewrites it only then.) */
export function needsTidy(g: GraphPlace, f: PlaceFieldName): boolean {
  const raw = f === 'name' ? g.canonicalName : f === 'type' ? g.type : null
  return raw !== null && raw !== (tidyText(raw) ?? '')
}

/** The stamps for the fields taken in. */
export const stampsFor = (kind: PlaceKind, d: Doc, fields: readonly PlaceFieldName[] = kind.fields): Record<string, string> =>
  Object.fromEntries(fields.map(f => [`${f}_sha`, sha(sanityValue(d, f))]))

/**
 * The node properties that make a field hold Sanity's value; null removes a property. The gallery and the slug are not
 * properties of their own: they are written by `GALLERY_QUERY` and the rename.
 */
export function propsFor(kind: PlaceKind, d: Doc, field: PlaceFieldName): Record<string, string | number | null> {
  const ref = (sanityProp: string) => sanMigRef(kind.key, d._id, sanityProp)
  switch (field) {
    case 'name': return { canonicalName: sanityValue(d, 'name') || null }
    case 'coordinates': {
      const lat = num(sanityCoordinates(d)?.lat), lng = num(sanityCoordinates(d)?.lng)
      const has = lat !== null && lng !== null
      return {
        lat: has ? lat : null, lng: has ? lng : null,
        lat_state: has ? 'candidate' : null, lng_state: has ? 'candidate' : null,
        lat_sourceRef: has ? ref('coordinates') : null, lng_sourceRef: has ? ref('coordinates') : null,
      }
    }
    case 'type': {
      const value = sanityValue(d, 'type') || null
      return { type: value, type_state: value ? 'candidate' : null, type_sourceRef: value ? ref('type') : null }
    }
    case 'gallery':
    case 'slug':
      return {}
  }
}

export interface PlaceRow {
  id:     string
  slug:   string
  props:  Record<string, string | number | null>
  stamps: Record<string, string>
  /** null while a field is held for review: sanityUpdatedAt must not move past it. */
  at:     string | null
}
export interface PlaceRename { id: string; from: string; to: string }
export interface PlaceGalleryRow { id: string; images: ImageSource[] }

export interface PlacePlan {
  rows:      PlaceRow[]
  galleries: PlaceGalleryRow[]
  renames:   PlaceRename[]
  held:      string[]
}

/** What to write for one place, from its verdicts. */
export function planPlace(kind: PlaceKind, g: GraphPlace, s: Doc, verdicts: FieldVerdict[], plan: PlacePlan): void {
  const props: Record<string, string | number | null> = {}
  const taken: PlaceFieldName[] = []
  let reviewHeld = false
  for (const { field, verdict } of verdicts) {
    if (verdict === 'conflict') { plan.held.push(`${g.slug}: ${field} (conflict)`); continue }
    if (verdict === 'review') { plan.held.push(`${g.slug}: ${field} (review)`); reviewHeld = true; continue }
    // An empty name in Sanity would blank the page's title: never taken.
    if (field === 'name' && !sanityValue(s, 'name')) { plan.held.push(`${g.slug}: name (empty in Sanity)`); reviewHeld = true; continue }
    taken.push(field)
    if (verdict === 'kept') continue
    if (field === 'gallery') { if (verdict === 'clean') plan.galleries.push({ id: g.sanityId, images: sanityImages(s) }); continue }
    if (field === 'slug') { if (verdict === 'clean') plan.renames.push({ id: g.sanityId, from: g.slug, to: sanitySlug(s) }); continue }
    if (verdict === 'already' && !needsTidy(g, field)) continue
    Object.assign(props, propsFor(kind, s, field))
  }
  if (!taken.length) return
  plan.rows.push({ id: g.sanityId, slug: g.slug, props, stamps: stampsFor(kind, s, taken), at: reviewHeld ? null : s._updatedAt })
}

/** The properties of a place new in Sanity: the import's rule, tidied, with stamps. Its gallery is written as for an edit. */
export function newPlaceProps(kind: PlaceKind, d: Doc): Record<string, unknown> {
  const p: Record<string, unknown> = { slug: sanitySlug(d), sanityId: d._id, sanityUpdatedAt: d._updatedAt, ...stampsFor(kind, d) }
  for (const f of kind.fields) for (const [k, v] of Object.entries(propsFor(kind, d, f))) if (v !== null) p[k] = v
  return p
}

/** Sanity's documents of one kind, current (not an export). */
export async function fetchSanityPlaces(kind: PlaceKind): Promise<Doc[]> {
  const out: Doc[] = []
  let lastId = ''
  for (;;) {
    const url = new URL(API)
    url.searchParams.set('query',
      `*[_type == $type && !(_id in path("drafts.**")) && _id > $lastId] | order(_id asc) [0...1000] { _id, _updatedAt, title, slug, coordinates, type, gallery }`)
    url.searchParams.set('$type', JSON.stringify(kind.key))
    url.searchParams.set('$lastId', JSON.stringify(lastId))
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Sanity ${res.status}`)
    const page = (await res.json() as { result: Doc[] }).result
    out.push(...page)
    if (page.length < 1000) return out
    lastId = page[page.length - 1]._id
  }
}

/** Every Sanity-CDN image of a node, in order, by its asset (the Source keeps it, or its id does). */
const CDN_IMAGES = `
  OPTIONAL MATCH (n)-[h:HAS_IMAGE]->(i:Source) WHERE i.url STARTS WITH 'https://cdn.sanity.io/'
  WITH n, h, i ORDER BY h.order
  WITH n, [x IN collect(coalesce(i.sanityAssetRef, replace(i.id, 'img:sanity:', ''))) WHERE x IS NOT NULL] AS imageRefs`

export const graphQuery = (kind: PlaceKind) => `
  MATCH (n:\`${kind.label}\`) WHERE n.sanityId IS NOT NULL
  ${CDN_IMAGES}
  RETURN n.sanityId AS sanityId, n.sanityUpdatedAt AS sanityUpdatedAt, n.slug AS slug,
         n.canonicalName AS canonicalName, n.lat AS lat, n.lng AS lng, n.type AS type, imageRefs,
         {name_sha: n.name_sha, coordinates_sha: n.coordinates_sha, type_sha: n.type_sha,
          gallery_sha: n.gallery_sha, slug_sha: n.slug_sha} AS stamps`

/** Every slug of the kind, nodes from Sanity or not, to keep a new or renamed slug from taking one that is used. */
export const slugsQuery = (kind: PlaceKind) => `MATCH (n:\`${kind.label}\`) RETURN n.slug AS slug, n.sanityId AS sanityId`

/**
 * Apply one batch of properties and stamps. `at` is null while a field is held for review: sanityUpdatedAt is what tells a
 * stamp-less field that Sanity changed since the import, so it must not move past it.
 */
export const applyQuery = (kind: PlaceKind) => `
  UNWIND $rows AS row
  MATCH (n:\`${kind.label}\` {sanityId: row.id})
  SET n += row.props, n += row.stamps, n.sanityUpdatedAt = coalesce(row.at, n.sanityUpdatedAt)
  RETURN count(n) AS n`

export const createQuery = (kind: PlaceKind) => `
  UNWIND $rows AS row
  CREATE (n:\`${kind.label}\`) SET n = row.props
  RETURN count(n) AS n`

/**
 * Make a node's Sanity-CDN images Sanity's gallery, in Sanity's order. Images an editor added from elsewhere, and what an
 * editor set on an edge (hero, scope, caption), are left alone: only a Sanity image Sanity no longer has goes, and only
 * `order` is set. The images are written in a subquery, so an empty gallery still counts its node.
 */
export const galleryQuery = (kind: PlaceKind) => `
  UNWIND $rows AS row
  MATCH (n:\`${kind.label}\` {sanityId: row.id})
  CALL (n, row) {
    OPTIONAL MATCH (n)-[r:HAS_IMAGE]->(old:Source)
      WHERE old.url STARTS WITH 'https://cdn.sanity.io/' AND NOT old.id IN [i IN row.images | i.id]
    DELETE r
  }
  CALL (n, row) {
    UNWIND row.images AS img
    MERGE (s:Source {id: img.id})
      ON CREATE SET s.type = 'photograph', s.url = img.url, s.sanityAssetRef = img.assetRef
    MERGE (n)-[h:HAS_IMAGE]->(s)
    SET h.order = img.order
  }
  RETURN count(DISTINCT n) AS n`

/**
 * Renames in two phases, so a chain (A → B while B → C) never holds a slug twice: first to a placeholder, then to the new
 * slug. The page's own description ids follow the slug (`desc:<kind>:<slug>:<order>`). The aliases are written after.
 */
export const renamePhaseQuery = (kind: PlaceKind) => `
  UNWIND $renames AS r
  MATCH (n:\`${kind.label}\` {sanityId: r.id})
  SET n.slug = r.to
  WITH n
  OPTIONAL MATCH (n)-[:HAS_CONTENT]->(d:Description)
  FOREACH (_ IN CASE WHEN d IS NULL THEN [] ELSE [1] END |
    SET d.id = 'desc:${kind.key}:' + n.slug + ':' + toString(coalesce(d.order, 1)))
  RETURN count(DISTINCT n) AS n`

/** What a node holds before a write, for the backup: its properties and its images. */
export const backupQuery = (kind: PlaceKind) => `
  MATCH (n:\`${kind.label}\`) WHERE n.sanityId IN $ids
  OPTIONAL MATCH (n)-[h:HAS_IMAGE]->(i:Source)
  RETURN properties(n) AS node, collect(CASE WHEN i IS NULL THEN NULL ELSE {image: i.id, edge: properties(h)} END) AS images`
