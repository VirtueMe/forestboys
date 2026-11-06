/**
 * The graph side of the photo backfill (#412): which Sources and descriptions name Sanity's
 * image CDN, and the two writes that point them at our bucket. Run by
 * scripts/sync/backfill-images.ts; tested against the local Neo4j in image-backfill-graph.neo4j.test.ts.
 */

/** Every Source on Sanity's CDN, with the places that reach it (`HAS_IMAGE:Person`, …; empty = no edge). */
export const SOURCES_QUERY = `
MATCH (s:Source) WHERE s.url STARTS WITH 'https://cdn.sanity.io/'
OPTIONAL MATCH (n)-[r:HAS_IMAGE|HAS_HERO_IMAGE]->(s)
WITH s, collect(DISTINCT type(r) + ':' + head(labels(n))) AS places
RETURN s.id AS id, s.url AS url, s.sanityAssetRef AS ref, places
ORDER BY s.id`

/**
 * Point Sources at the bucket and keep the Sanity key. Only a Source still on Sanity's CDN is
 * touched, so a repeat changes nothing and an address an editor set meanwhile is kept.
 * rows: [{ id, url, key }]
 */
export const SET_URL_QUERY = `
UNWIND $rows AS row
MATCH (s:Source {id: row.id}) WHERE s.url STARTS WITH 'https://cdn.sanity.io/'
SET s.url = row.url, s.sanityKey = row.key
RETURN count(s) AS n`

/** Every description whose text names Sanity's image CDN. */
export const DESCRIPTIONS_QUERY = `
MATCH (d:Description) WHERE d.content CONTAINS 'cdn.sanity.io'
RETURN d.id AS id, d.content AS content
ORDER BY d.id`

/** Replace the text, but only if it is still what was read: an edit made meanwhile is not overwritten. rows: [{ id, before, after }] */
export const SET_CONTENT_QUERY = `
UNWIND $rows AS row
MATCH (d:Description {id: row.id}) WHERE d.content = row.before
SET d.content = row.after
RETURN count(d) AS n`

/** A place as the report names it. */
export function placeKind(places: readonly string[]): string {
  if (!places.length) return 'no edge'
  const first = [...places].sort()[0]
  return first.replace(':', ' → ')
}
