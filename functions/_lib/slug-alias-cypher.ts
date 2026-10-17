/**
 * Cypher for the slug aliases (#96) that a script runs against the graph, as plain strings: no imports, so a script can
 * use them without the Worker code (functions/_lib/neo4j.ts) and its compiler settings.
 */

/**
 * Housekeeping for a writer that lets a live slug win over an alias (the Sanity sync, where Sanity decides and a freed
 * slug is reused): an alias with a live page of the same slug on its address space goes; so does an alias whose
 * entity is gone. The web app never needs it: its renames and creates refuse a taken slug.
 */
export const dropShadowedAliases = (label: string, route: string) =>
  `MATCH (a:SlugAlias {route: '${route}'}) MATCH (n:\`${label}\` {slug: a.slug}) DETACH DELETE a`
export const DROP_DANGLING_ALIASES = `MATCH (a:SlugAlias) WHERE NOT (a)-[:ALIAS_OF]->() DETACH DELETE a`

/**
 * A Sanity sync renames pages of one kind (`$renames`: `[{id, from}]`, `$at`): each keeps its old slug as an alias. Run it
 * after the renames, then `dropShadowedAliases(label, route)`: a slug another page has taken over in the same run (the
 * freed slug of a split) is theirs, not an alias.
 */
export const renameAliases = (label: string, route: string) => `
  UNWIND $renames AS r
  MATCH (p:\`${label}\` {sanityId: r.id})
  MERGE (a:SlugAlias {route: '${route}', slug: r.from})
  ON CREATE SET a.kind = '${label}', a.createdAt = $at
  WITH a, p
  OPTIONAL MATCH (a)-[old:ALIAS_OF]->()
  DELETE old
  MERGE (a)-[:ALIAS_OF]->(p)`

/** The person sync's renames (`renameAliases` for Person). */
export const PERSON_RENAME_ALIASES = renameAliases('Person', '/person/')
