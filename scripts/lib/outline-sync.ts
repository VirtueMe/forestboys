/**
 * Sanity → graph sync of an outline's node (#301, part of #156): a node for an outline new in Sanity, its title, the people
 * it mentions and its gallery. Its text and its links are synced by the description and link syncs
 * (scripts/lib/description-sync.ts, link-sync.ts), both with an `outline` kind. docs/SANITY-SYNC.md («Outlines»).
 *
 * An outline is Jan's text, and what is made of it is a bundle he reviews (docs/PROPOSALS.md): this sync keeps the node
 * true to Sanity and decides nothing about what goes into the graph. Once the text moves, the outline's version (a hash
 * of its text, functions/_lib/outline-version.ts) moves with it, and an absorbed outline is `stale`: a new bundle is what
 * that calls for, and the admin's «request a bundle» makes it. The sync requests none.
 *
 * Where the graph keeps each field (the shape import-outlines.ts made):
 *   title    canonicalName                                  (the slug when Sanity has no title)
 *   people   (o)-[:MENTIONS]->(:Person {sanityId})          the people the graph has; added, none removed
 *   gallery  (o)-[:HAS_IMAGE {order}]->(:Source {id: 'img:sanity:<asset>'}), the Sanity-CDN images
 * The slug is made once and not changed by the sync. `sanityRev` is not moved either: the version of an outline is its
 * text's hash, and Sanity's `_rev` goes at the cutover (#159).
 *
 * Per field, against its stamp (`<field>_sha`, the hash of the Sanity value last taken in): the verdicts of the place
 * sync. Without a stamp the April export is the baseline (a graph still holding the export's value was not edited); a
 * node with nothing in the graph for the field takes Sanity's. `people` never conflicts: the missing mentions are added.
 */

import { API, sha, type Doc } from './person-sync.ts'
import { imageSources, type ImageSource } from './person-rule.ts'

export const OUTLINE_FIELDS = ['title', 'people', 'gallery'] as const
export type OutlineFieldName = typeof OUTLINE_FIELDS[number]

/** Sanity outlines the sync leaves alone, by id, with the reason: the bundles of the Linge members outline are made. */
export const LEFT_ALONE: ReadonlyMap<string, string> = new Map([
  ['917b8cb9-6a12-4a96-91eb-8444691d6797', 'Linge members: its bundles are made'],
])

export interface GraphOutline {
  sanityId:   string
  slug:       string
  canonicalName: string | null
  /** The `sanityId` of the people the outline mentions. */
  mentions:   string[]
  /** The Sanity-CDN images, in their order. */
  imageRefs:  string[]
  stamps:     Partial<Record<`${OutlineFieldName}_sha`, string | null>>
}

export type OutlineVerdict = 'clean' | 'already' | 'conflict' | 'review'
export interface FieldVerdict { field: OutlineFieldName; verdict: OutlineVerdict }

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
export const sanitySlug = (d: Doc): string => str((d.slug as { current?: string } | undefined)?.current).trim()
export const sanityTitle = (d: Doc): string => str(d.title).trim() || sanitySlug(d)
export const sanityImages = (d: Doc): ImageSource[] => imageSources(d.gallery)
/** The people Sanity names, as the graph can resolve them (`known`: the graph's Person sanityIds), sorted. */
export const sanityPeople = (d: Doc, known: ReadonlySet<string>): string[] =>
  [...new Set(((d.people as { _ref?: string }[] | undefined) ?? []).map(r => r?._ref ?? '').filter(id => known.has(id)))].sort()

const join = (xs: string[]) => xs.join('\n')

export function sanityValue(d: Doc, f: OutlineFieldName, known: ReadonlySet<string>): string {
  switch (f) {
    case 'title':   return sanityTitle(d)
    case 'people':  return join(sanityPeople(d, known))
    case 'gallery': return sanityImages(d).map(i => i.assetRef).join(' ')
  }
}

export function graphValue(g: GraphOutline, f: OutlineFieldName): string {
  switch (f) {
    case 'title':   return (g.canonicalName ?? '').trim()
    case 'people':  return join([...new Set(g.mentions)].sort())
    case 'gallery': return g.imageRefs.join(' ')
  }
}

/** The fields of one outline that need a decision or a stamp. A field Sanity has not changed since its stamp is left out. */
export function classifyOutline(g: GraphOutline, s: Doc, known: ReadonlySet<string>, baseline?: Doc): FieldVerdict[] {
  const out: FieldVerdict[] = []
  for (const field of OUTLINE_FIELDS) {
    const now = sanityValue(s, field, known), graph = graphValue(g, field)
    const stamp = g.stamps[`${field}_sha`]
    const push = (verdict: OutlineVerdict) => out.push({ field, verdict })

    if (field === 'people') {
      if (stamp && sha(now) === stamp) continue
      // Only added: a mention is clean when the graph lacks one Sanity names, otherwise the stamp just moves.
      const have = new Set(g.mentions)
      push(sanityPeople(s, known).every(id => have.has(id)) ? 'already' : 'clean')
      continue
    }
    if (stamp) {
      if (sha(now) === stamp) continue
      if (graph === now) push('already')
      else if (sha(graph) === stamp) push('clean')
      else push('conflict')
      continue
    }
    if (graph === now) push('already')
    else if (graph === '') push('clean')
    else if (baseline) push(graph === sanityValue(baseline, field, known) ? 'clean' : 'conflict')
    else push('review')
  }
  return out
}

/** The stamps for the fields taken in. */
export const stampsFor = (d: Doc, known: ReadonlySet<string>, fields: readonly OutlineFieldName[] = OUTLINE_FIELDS): Record<string, string> =>
  Object.fromEntries(fields.map(f => [`${f}_sha`, sha(sanityValue(d, f, known))]))

export interface OutlineRow {
  id:      string
  slug:    string
  props:   Record<string, string>
  stamps:  Record<string, string>
  /** The people to join (sanityIds), or null when the field is not taken. */
  people:  string[] | null
  /** The gallery to write, or null when the field is not taken. */
  gallery: ImageSource[] | null
}

/** What to write for one outline, from its verdicts. `held` collects what is left alone. */
export function planOutline(g: GraphOutline, s: Doc, verdicts: FieldVerdict[], known: ReadonlySet<string>, held: string[]): OutlineRow | null {
  const row: OutlineRow = { id: g.sanityId, slug: g.slug, props: {}, stamps: {}, people: null, gallery: null }
  const taken: OutlineFieldName[] = []
  for (const { field, verdict } of verdicts) {
    if (verdict === 'conflict' || verdict === 'review') { held.push(`${g.slug}: ${field} (${verdict})`); continue }
    taken.push(field)
    if (verdict === 'already') continue
    if (field === 'title') row.props.canonicalName = sanityTitle(s)
    if (field === 'people') row.people = sanityPeople(s, known)
    if (field === 'gallery') row.gallery = sanityImages(s)
  }
  if (!taken.length) return null
  row.stamps = stampsFor(s, known, taken)
  return row
}

/** The node of an outline new in Sanity: the import's shape (import-outlines.ts), with stamps. */
export const newOutlineProps = (d: Doc, known: ReadonlySet<string>): Record<string, unknown> => ({
  slug: sanitySlug(d), canonicalName: sanityTitle(d), sanityId: d._id, sanityRev: str(d._rev), sanityImportedAt: new Date().toISOString(),
  ...stampsFor(d, known),
})

/** Sanity's outlines, current (not an export). */
export async function fetchSanityOutlines(): Promise<Doc[]> {
  const url = new URL(API)
  url.searchParams.set('query',
    `*[_type == "outline" && !(_id in path("drafts.**"))] | order(_id asc) { _id, _rev, _updatedAt, title, slug, description, gallery, "people": people[]{_ref} }`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Sanity ${res.status}`)
  return (await res.json() as { result: Doc[] }).result
}

export const PEOPLE_QUERY = `MATCH (p:Person) WHERE p.sanityId IS NOT NULL RETURN p.sanityId AS id`

/** Every Sanity-CDN image of an outline, in order, by its asset. */
export const GRAPH_QUERY = `
  MATCH (o:Outline) WHERE o.sanityId IS NOT NULL
  OPTIONAL MATCH (o)-[h:HAS_IMAGE]->(i:Source) WHERE i.url STARTS WITH 'https://cdn.sanity.io/'
  WITH o, h, i ORDER BY h.order
  WITH o, [x IN collect(coalesce(i.sanityAssetRef, replace(i.id, 'img:sanity:', ''))) WHERE x IS NOT NULL] AS imageRefs
  RETURN o.sanityId AS sanityId, o.slug AS slug, o.canonicalName AS canonicalName, imageRefs,
         [(o)-[:MENTIONS]->(p:Person) WHERE p.sanityId IS NOT NULL | p.sanityId] AS mentions,
         {title_sha: o.title_sha, people_sha: o.people_sha, gallery_sha: o.gallery_sha} AS stamps`

export const SLUGS_QUERY = `MATCH (o:Outline) RETURN o.slug AS slug`

/** Apply one batch of properties and stamps. */
export const APPLY_QUERY = `
  UNWIND $rows AS row
  MATCH (o:Outline {sanityId: row.id})
  SET o += row.props, o += row.stamps
  RETURN count(o) AS n`

/** The node and its single Description (`desc:Outline:<slug>:1`, the text as the import wrote it). */
export const CREATE_QUERY = `
  UNWIND $rows AS row
  CREATE (o:Outline) SET o = row.props
  CREATE (o)-[:HAS_CONTENT]->(:Description {id: row.descId, order: 1, content: row.content})
  RETURN count(o) AS n`

/** Join the people Sanity names; none is removed. A person the graph does not have is skipped (it is not in `row.people`). */
export const MENTIONS_QUERY = `
  UNWIND $rows AS row
  MATCH (o:Outline {sanityId: row.id})
  CALL (o, row) {
    UNWIND row.people AS pid
    MATCH (p:Person {sanityId: pid})
    MERGE (o)-[:MENTIONS]->(p)
  }
  RETURN count(DISTINCT o) AS n`

/**
 * Make an outline's Sanity-CDN images Sanity's gallery, in Sanity's order. Images an editor added from elsewhere, and what
 * an editor set on an edge (hero, scope, a caption), are left alone: only a Sanity image Sanity no longer has goes, and
 * `order` is set. The images are written in subqueries, so an empty gallery still counts its node.
 */
export const GALLERY_QUERY = `
  UNWIND $rows AS row
  MATCH (o:Outline {sanityId: row.id})
  CALL (o, row) {
    OPTIONAL MATCH (o)-[r:HAS_IMAGE]->(old:Source)
      WHERE old.url STARTS WITH 'https://cdn.sanity.io/' AND NOT old.id IN [i IN row.images | i.id]
    DELETE r
  }
  CALL (o, row) {
    UNWIND row.images AS img
    MERGE (s:Source {id: img.id})
      ON CREATE SET s.type = 'photograph', s.url = img.url, s.sanityAssetRef = img.assetRef
    MERGE (o)-[h:HAS_IMAGE]->(s)
    SET h.order = img.order, h.caption = coalesce(h.caption, img.caption)
  }
  RETURN count(DISTINCT o) AS n`

/** What a node holds before a write, for the backup: its properties, its images and its mentions. */
export const BACKUP_QUERY = `
  MATCH (o:Outline) WHERE o.sanityId IN $ids
  RETURN o.sanityId AS sanityId, o.slug AS slug, properties(o) AS props,
         [(o)-[h:HAS_IMAGE]->(i:Source) | {image: i.id, edge: properties(h)}] AS images,
         [(o)-[:MENTIONS]->(p:Person) | p.sanityId] AS mentions`
