/**
 * Sanity → graph sync of the `links` of transports, locations and stations (#118). Events and people have it as a field
 * of their syncs; these three only got links when the import created the node. docs/SANITY-SYNC.md («Links»).
 *
 * What is a link is decided in one place, `importableLinks()` / `linkSource()` (scripts/lib/person-rule.ts, #113), so the
 * Source id and url are the same as for events and people:
 *   links[]  →  (n)-[:REFERENCED_IN]->(:Source {id: urlToId(url), url, …})
 *
 * The stamp is `links_sha`, the hash of the set of imported URLs as last taken in from Sanity (`links_sanityUpdatedAt`
 * says from which version). The node's own `sanityUpdatedAt` is not touched: the field syncs of the same node use it.
 * Only the import's edges are compared and replaced: an edge an editor made (`sourceRef: 'admin-edit'`) is not part of
 * the set and is never removed.
 *
 * Per node, against its stamp:
 *   unchanged  Sanity holds what the stamp says: nothing
 *   clean      Sanity changed, the graph still holds the stamped set: apply (links Sanity dropped go)
 *   already    Sanity changed (or there is no stamp yet) and the graph already holds the new set: the stamp moves
 *   conflict   Sanity changed and the graph's set was edited: left alone, listed
 *   gap        no stamp, and Sanity's links are as in the baseline export: the import missed some (#113) or the node
 *              was made without them. Sanity's missing links are added; nothing is removed
 *   review     no stamp, the graph differs, and there is no baseline to tell who changed what: left alone, listed
 *              (`--accept-review=<slug>,…` applies Sanity's set)
 * A node with no import links in the graph and no stamp takes Sanity's set (`clean`): there is nothing to overwrite.
 */

import { API, sha, type Doc } from './person-sync.ts'
import { importableLinks, linkSource, type LinkSource } from './person-rule.ts'

export interface LinkKind {
  /** Used in the file names and the SyncState row. */
  key:        'transport' | 'location' | 'station'
  /** The graph label. */
  label:      'Transport' | 'Location' | 'Station'
  /** The Sanity document type. */
  sanityType: string
}

export const LINK_KINDS: Record<string, LinkKind> = {
  transport: { key: 'transport', label: 'Transport', sanityType: 'transport' },
  location:  { key: 'location',  label: 'Location',  sanityType: 'location' },
  station:   { key: 'station',   label: 'Station',   sanityType: 'station' },
}

export interface GraphLinks {
  sanityId: string
  slug:     string
  /** The URLs of the node's import edges (every REFERENCED_IN that an editor did not make). */
  links:    string[]
  /** `links_sha` on the node. */
  stamp:    string | undefined
}

export type LinkVerdict = 'unchanged' | 'clean' | 'already' | 'conflict' | 'gap' | 'review'

/** A set of URLs in the one form both sides are compared in. */
const setKey = (urls: string[]) => [...new Set(urls)].sort().join('\n')

export const sanityUrls = (d: Doc): string[] => importableLinks(d.links).map(l => l.url)
export const sanityLinkSources = (d: Doc): LinkSource[] => importableLinks(d.links).map(l => linkSource(l.url, l.title))
export const sanityValue = (d: Doc): string => setKey(sanityUrls(d))
export const graphValue = (g: GraphLinks): string => setKey(g.links)

/** `base` is the node's document in the baseline export, when there is one. */
export function classifyLinks(g: GraphLinks, d: Doc, base?: Doc): LinkVerdict {
  const now = sanityValue(d), graph = graphValue(g)
  if (g.stamp !== undefined) {
    if (sha(now) === g.stamp) return 'unchanged'
    if (graph === now) return 'already'
    return sha(graph) === g.stamp ? 'clean' : 'conflict'
  }
  if (graph === now) return 'already'
  if (graph === '') return 'clean'
  if (!base) return 'review'
  const was = sanityValue(base)
  if (graph === was) return 'clean'
  return was === now ? 'gap' : 'conflict'
}

/** The properties that record what was taken in. */
export const stampsFor = (d: Doc) => ({ links_sha: sha(sanityValue(d)), links_sanityUpdatedAt: d._updatedAt })

/** Sanity's documents of a type, with their links. Reads current Sanity, not an export. */
export async function fetchSanityLinks(kind: LinkKind): Promise<Doc[]> {
  const out: Doc[] = []
  let lastId = ''
  for (;;) {
    const url = new URL(API)
    url.searchParams.set('query',
      `*[_type == $type && !(_id in path("drafts.**")) && _id > $lastId] | order(_id asc) [0...1000] { _id, _updatedAt, links }`)
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

/** The graph side, by Sanity id. */
export const graphQuery = (kind: LinkKind) => `
  MATCH (n:\`${kind.label}\`) WHERE n.sanityId IS NOT NULL
  RETURN n.sanityId AS sanityId, n.slug AS slug, n.links_sha AS stamp,
         [(n)-[r:REFERENCED_IN]->(s:Source) WHERE s.url IS NOT NULL AND coalesce(r.sourceRef, '') <> 'admin-edit' | s.url] AS links`

/**
 * Make the node's import links Sanity's: the Sources are merged by id and joined, and with `row.prune` the import edges to
 * a Source Sanity no longer lists are deleted (the Source stays; an editor's edge stays). The links are written in
 * subqueries, so a node with none still counts.
 */
export const applyQuery = (kind: LinkKind) => `
  UNWIND $rows AS row
  MATCH (n:\`${kind.label}\` {sanityId: row.id})
  CALL (n, row) {
    OPTIONAL MATCH (n)-[r:REFERENCED_IN]->(old:Source)
      WHERE row.prune AND old.url IS NOT NULL AND coalesce(r.sourceRef, '') <> 'admin-edit' AND NOT old.id IN [x IN row.links | x.id]
    DELETE r
  }
  CALL (n, row) {
    UNWIND row.links AS src
    MERGE (s:Source {id: src.id}) ON CREATE SET s += src
    MERGE (n)-[:REFERENCED_IN]->(s)
  }
  SET n += row.stamps
  RETURN count(DISTINCT n) AS n`

/** What a node holds before a write, for the backup: its stamps and its links. */
export const backupQuery = (kind: LinkKind) => `
  MATCH (n:\`${kind.label}\`) WHERE n.sanityId IN $ids
  RETURN n.sanityId AS sanityId, n.slug AS slug, n.links_sha AS links_sha, n.links_sanityUpdatedAt AS links_sanityUpdatedAt,
         [(n)-[r:REFERENCED_IN]->(s:Source) | {source: s.id, edge: properties(r)}] AS links`
