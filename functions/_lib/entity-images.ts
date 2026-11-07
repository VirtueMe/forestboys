/**
 * The Cypher of an entity's own photos (#414): `HAS_IMAGE` edges from the entity to a `Source`.
 * Apart from the route so the real Neo4j can test it (`entity-images.neo4j.test.ts`). `labels` is
 * never user input: the route maps the URL kind to it from a fixed list.
 */

/** A label expression for the queries below: `Person`, or `Operation`|`Incident`. */
export const labelExpr = (...names: string[]) => names.map(n => `\`${n}\``).join('|')

export interface OwnImage {
  id:      string
  url:     string
  caption: string | null
  isHero:  boolean
  order:   number
}

export const entityExistsQuery = (labels: string) =>
  `MATCH (e:${labels} {slug: $slug}) RETURN 1 AS n`

export const listImagesQuery = (labels: string) => `
  MATCH (:${labels} {slug: $slug})-[h:HAS_IMAGE]->(s:Source)
  RETURN s.id AS id, s.url AS url, h.caption AS caption,
         coalesce(h.isHero, false) AS isHero, coalesce(h.order, 999) AS order
  ORDER BY order, id
`

/** The same photo on the same entity twice is one edge. The first photo of an entity is its hero. */
export const addImageQuery = (labels: string) => `
  MATCH (e:${labels} {slug: $slug})
  MERGE (s:Source {id: $sourceId})
    ON CREATE SET s.url = $url, s.kind = 'photograph', s.type = 'photograph',
                  s.license = $license, s.attribution = $attribution
  WITH e, s
  OPTIONAL MATCH (e)-[mine:HAS_IMAGE]->()
  WITH e, s, count(mine) AS had, coalesce(max(mine.order), 0) AS top
  MERGE (e)-[h:HAS_IMAGE]->(s)
    ON CREATE SET h.order = top + 1, h.caption = $caption, h.isHero = (had = 0)
`

/** `$ids`: every photo of the entity, in the new order. */
export const setOrderQuery = (labels: string) => `
  MATCH (e:${labels} {slug: $slug})
  UNWIND range(0, size($ids) - 1) AS i
  MATCH (e)-[h:HAS_IMAGE]->(s:Source {id: $ids[i]})
  SET h.order = i + 1
`

/** `$caps`: [[sourceId, caption | null], …]. */
export const setCaptionsQuery = (labels: string) => `
  MATCH (e:${labels} {slug: $slug})
  UNWIND $caps AS c
  MATCH (e)-[h:HAS_IMAGE]->(s:Source {id: c[0]})
  SET h.caption = c[1]
`

/** `$hero`: a Source id, or null for no hero. */
export const setHeroQuery = (labels: string) => `
  MATCH (e:${labels} {slug: $slug})-[h:HAS_IMAGE]->(s:Source)
  SET h.isHero = (s.id = $hero)
`

/** Removes the edge only: the Source and the files stay. */
export const removeImageQuery = (labels: string) => `
  MATCH (e:${labels} {slug: $slug})-[h:HAS_IMAGE]->(s:Source {id: $id})
  DELETE h
  RETURN 1 AS n
`
