/**
 * Sources stored with whitespace round their address (#113). Before the link rule trimmed, a link
 * with a trailing space passed the import check and was stored as written: the Source's `url` has the
 * space, and its `id` (url→id hash, scripts/lib/person-rule.ts) differs from the trimmed address's.
 *
 * Per such Source, against the id its trimmed address gets:
 *   delete  nothing refers to it any more (the sync's clean apply moved its owners to the trimmed Source)
 *   rename  no Source has that id yet: the Source takes the trimmed `url` and the new `id`, in place
 *   merge   one has (a twin, or an earlier rename in this run): the owners' REFERENCED_IN edges move to
 *           it and the padded Source is deleted
 *   skip    the trimmed address is not an http(s) address: not touched
 *
 * Run it AFTER the sync's first write, not before. The sync's stamp for a node's links is the hash of
 * what was last taken in, padded address and all; renaming a Source first changes what the graph holds,
 * so a node that has both a padded link and a leading-space link Sanity never delivered
 * (martin-pettersen-hovden) would read as a graph edit — a false `conflict` instead of `clean`. After
 * the sync the owners that sync covers already hold the trimmed Sources; what is left is the padded
 * Sources nothing refers to (deleted) and owners no sync covers, such as transports (renamed or merged).
 */

import { isImportableUrl, urlToId } from './person-rule.ts'

export interface PaddedSource { id: string; url: string; /** Relationships on the Source: 0 once its owners have moved. */ owners: number }

export type SourceAction =
  | { kind: 'rename'; id: string; to: string; url: string }
  | { kind: 'merge'; id: string; into: string }
  | { kind: 'delete'; id: string }
  | { kind: 'skip'; id: string; reason: string }

/** The actions for `padded`, given the ids of all Sources in the graph. */
export function planNormalise(padded: PaddedSource[], existingIds: Iterable<string>): SourceAction[] {
  const taken = new Set(existingIds)
  const out: SourceAction[] = []
  for (const s of padded) {
    if (s.owners === 0) { out.push({ kind: 'delete', id: s.id }); continue }
    const url = s.url.trim()
    if (!isImportableUrl(url)) { out.push({ kind: 'skip', id: s.id, reason: 'not an http(s) address once trimmed' }); continue }
    const to = urlToId(url)
    if (to === s.id) { out.push({ kind: 'skip', id: s.id, reason: 'id already the trimmed one' }); continue }
    if (taken.has(to)) { out.push({ kind: 'merge', id: s.id, into: to }); continue }
    taken.add(to)
    out.push({ kind: 'rename', id: s.id, to, url })
  }
  return out
}

/** Sources whose `url` starts or ends with whitespace, with their owners. */
export const PADDED_QUERY = `
  MATCH (x:Source) WHERE x.url =~ '(?s)^\\\\s.*|.*\\\\s$'
  RETURN x.id AS id, x.url AS url, size([(x)--() | 1]) AS owners ORDER BY x.id`

export const RENAME_QUERY = `
  MATCH (x:Source {id: $id}) SET x.id = $to, x.url = $url RETURN count(x) AS n`

/** Drop a padded Source nothing refers to. */
export const DELETE_QUERY = `MATCH (x:Source {id: $id}) WHERE NOT (x)--() DETACH DELETE x RETURN count(*) AS n`

/** Move the owners to the twin (an edge it already has is kept), then drop the padded Source if nothing else hangs on it. */
export const MERGE_QUERIES = [
  `MATCH (x:Source {id: $id}), (t:Source {id: $into})
   SET t.title = coalesce(t.title, x.title)
   WITH x, t
   OPTIONAL MATCH (a)-[r:REFERENCED_IN]->(x)
   WITH t, a, r WHERE a IS NOT NULL
   MERGE (a)-[r2:REFERENCED_IN]->(t) ON CREATE SET r2 += properties(r)
   DELETE r
   RETURN count(a) AS n`,
  DELETE_QUERY,
] as const
