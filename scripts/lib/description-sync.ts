/**
 * Sanity → graph sync of descriptions for the types that never had theirs imported
 * (#99: transports, stations, locations). Docs/SANITY-SYNC.md has the bridge; this is its
 * description-only form, with the stamp on the parent node as for people (`description_sha`).
 *
 * One description per node, in the shape the editor writes
 * (functions/api/admin/<kind>/[slug]/sections.ts) and the person import wrote:
 *
 *   (n)-[:HAS_CONTENT]->(Description {id: 'desc:<kind>:<slug>:1', order: 1, content})
 *
 * `content` is Sanity's Portable Text with its AIR 27 references made links
 * (src/utils/archiveRefs.ts, #106), so a description is stored the same way for every type.
 *
 * The stamp is the hash of that value as it was last taken in from Sanity:
 *   description_sha, description_sourceRef, description_state, description_sanityUpdatedAt.
 * Per node, against its stamp:
 *   unchanged  Sanity has not changed since the last import (or both are empty): nothing to do
 *   new        no stamp, nothing in the graph, text in Sanity: import it
 *   clean      Sanity changed, the graph still holds the stamped text: apply
 *   already    Sanity changed, the graph already holds the new text: only the stamp moves
 *   conflict   Sanity changed and the graph text was edited: left alone, listed
 *   review     no stamp, and the graph already has text of its own: left alone, listed
 * Graph text is never overwritten: only `new` and `clean` write it.
 */

import { stableJson } from './sanity-sha.ts'
import { API, sha, type Doc } from './person-sync.ts'
import { linkArchiveBlocks } from '../../src/utils/archiveRefs.ts'
import { blocksToText } from '../../src/utils/portableText.ts'
import { preformattedFromSanity } from './preformatted-blocks.ts'

export interface DescriptionKind {
  /** Used in ids, provenance and the SyncState row. */
  key:        string
  /** The graph label. */
  label:      string
  /** The Sanity document type. */
  sanityType: string
  /** The kind in a Description id, when it is not `key` (outlines were imported as `desc:Outline:<slug>:1`). */
  idKey?:     string
  /** Take Sanity's blocks as they are, without making AIR 27 references links (outlines were imported so, and their text is hashed). */
  plainBlocks?: true
  /** A node with no stamp is compared with the April export (data/sanity-baseline-2026-04/sanity-<type>.json): a graph still holding the export's text was not edited. */
  baseline?:  true
  /** Sanity documents the sync leaves alone, by id, with the reason. */
  skip?:      ReadonlyMap<string, string>
}

export const KINDS: Record<string, DescriptionKind> = {
  transport: { key: 'transport', label: 'Transport', sanityType: 'transport' },
  station:   { key: 'station',   label: 'Station',   sanityType: 'station' },
  location:  { key: 'location',  label: 'Location',  sanityType: 'location' },
  // The bundles of the "N.O.R.I.C.(1) (LINGE) Medlemmer" outline were made by the earlier import: nothing to change there (#301).
  outline:   { key: 'outline',   label: 'Outline',   sanityType: 'outline', idKey: 'Outline', plainBlocks: true, baseline: true,
               skip: new Map([['917b8cb9-6a12-4a96-91eb-8444691d6797', 'Linge members: its bundles are made']]) },
}

/**
 * Does any block hold text? Boxes and table cells are read too (#314): a description an editor gave a table has
 * text, and a sync that took it for empty would write Sanity's text over it.
 */
export function hasText(blocks: unknown): boolean {
  return Array.isArray(blocks) && blocksToText(blocks).trim() !== ''
}

/** The blocks the graph should hold for `d`: Sanity's, with AIR 27 references linked and the tables marked (#260). Null when there is no text. */
export function importedBlocks(d: Doc, kind?: DescriptionKind): unknown[] | null {
  if (!hasText(d.description)) return null
  return preformattedFromSanity(kind?.plainBlocks ? d.description as unknown[] : linkArchiveBlocks(d.description as unknown[]))
}

/** What is compared and stamped: the imported blocks as stable JSON, or '' for no text. */
export const sanityValue = (d: Doc, kind?: DescriptionKind): string => { const b = importedBlocks(d, kind); return b ? stableJson(b) : '' }

/** The same for what the graph holds (the Description's `content` string). */
export function graphValue(content: string | null | undefined): string {
  if (!content) return ''
  try {
    const blocks = JSON.parse(content)
    return hasText(blocks) ? stableJson(blocks) : ''
  } catch { return content }
}

export interface GraphDescription {
  sanityId: string
  slug:     string
  /** `description_sha` on the node: the hash of what was last taken in from Sanity. */
  stamp:    string | undefined
  /** `content` of the node's order-1 Description, or null when it has none. */
  content:  string | null
}

export type DescriptionVerdict = 'unchanged' | 'new' | 'clean' | 'already' | 'conflict' | 'review'

export function classifyDescription(g: GraphDescription, d: Doc, kind?: DescriptionKind, base?: Doc): DescriptionVerdict {
  const now = sanityValue(d, kind), graph = graphValue(g.content)
  if (g.stamp === undefined) {
    if (graph === now) return now === '' ? 'unchanged' : 'already'
    if (graph === '') return 'new'
    // The April export is the baseline: a graph still holding its text was not edited, so Sanity's change is clean.
    if (base) return graph === sanityValue(base, kind) ? 'clean' : 'conflict'
    return 'review'
  }
  if (sha(now) === g.stamp) return 'unchanged'
  if (graph === now) return 'already'
  return sha(graph) === g.stamp ? 'clean' : 'conflict'
}

/** The properties that record what was taken in, following the person descriptions' pattern. */
export const stampsFor = (kind: DescriptionKind, d: Doc) => ({
  description_sha:             sha(sanityValue(d, kind)),
  description_sourceRef:       `sanity-migration:${kind.key}:${d._id}:description`,
  description_state:           'candidate',
  description_sanityUpdatedAt: d._updatedAt,
})

/** The id of the order-1 Description the editor and this sync share. */
export const descriptionId = (kind: DescriptionKind, slug: string) => `desc:${kind.idKey ?? kind.key}:${slug}:1`

/** The Sanity documents of a type, with their description. Reads current Sanity, not an export. */
export async function fetchSanityDescriptions(kind: DescriptionKind): Promise<Doc[]> {
  const out: Doc[] = []
  let lastId = ''
  for (;;) {
    const url = new URL(API)
    url.searchParams.set('query',
      `*[_type == $type && !(_id in path("drafts.**")) && _id > $lastId] | order(_id asc) [0...1000] { _id, _updatedAt, description }`)
    url.searchParams.set('$type', JSON.stringify(kind.sanityType))
    url.searchParams.set('$lastId', JSON.stringify(lastId))
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Sanity ${res.status}`)
    const page = (await res.json() as { result: Doc[] }).result
    out.push(...page)
    if (page.length < 1000) return out
    lastId = page[page.length - 1]._id
  }
}

/** The graph side, by Sanity id: the stamp and the order-1 Description's content. */
export const GRAPH_QUERY = (kind: DescriptionKind) => `
  MATCH (n:\`${kind.label}\`) WHERE n.sanityId IS NOT NULL
  RETURN n.sanityId AS sanityId, n.slug AS slug, n.description_sha AS stamp,
         head([(n)-[:HAS_CONTENT]->(d:Description) WHERE d.order = 1 | d.content]) AS content`

/**
 * Put `row.content` in the order-1 Description and record the stamp. A Description that is there
 * keeps its node, id and edges (an editor's CITES and SOURCED_FROM stay): only the text changes.
 */
export const UPSERT_QUERY = (kind: DescriptionKind) => `
  UNWIND $rows AS row
  MATCH (n:\`${kind.label}\` {sanityId: row.id})
  OPTIONAL MATCH (n)-[:HAS_CONTENT]->(old:Description) WHERE old.order = 1
  WITH n, row, head(collect(old)) AS old
  FOREACH (o IN CASE WHEN old IS NULL THEN [] ELSE [old] END | SET o.content = row.content)
  FOREACH (_ IN CASE WHEN old IS NULL THEN [1] ELSE [] END |
    CREATE (n)-[:HAS_CONTENT]->(:Description {id: row.descId, order: 1, content: row.content}))
  SET n += row.stamps
  RETURN count(DISTINCT n) AS n`

/** Sanity emptied the text and the graph was still as stamped: the Description goes, with its edges. */
export const REMOVE_QUERY = (kind: DescriptionKind) => `
  UNWIND $rows AS row
  MATCH (n:\`${kind.label}\` {sanityId: row.id})
  OPTIONAL MATCH (n)-[:HAS_CONTENT]->(old:Description) WHERE old.order = 1
  DETACH DELETE old
  WITH DISTINCT n, row
  SET n += row.stamps
  RETURN count(DISTINCT n) AS n`

/** Only the stamp moves (the graph already holds the text). */
export const STAMP_QUERY = (kind: DescriptionKind) => `
  UNWIND $rows AS row
  MATCH (n:\`${kind.label}\` {sanityId: row.id}) SET n += row.stamps
  RETURN count(n) AS n`
