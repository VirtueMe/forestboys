/**
 * Stays — `(:Person)-[:STATIONED_AT]->(:Location | :Station)`, one edge per
 * period (docs/PERSON-STATIONED-AT.md). Shared by the Person-side and
 * place-side save endpoints.
 *
 * Edge properties: `id` (stable across saves — the stay's note hangs off
 * it), `role`, `startDate`, `endDate`, `state` ('candidate' for migrated
 * links nobody has reviewed, 'verified' once edited), `sourceRef`
 * (provenance of migrated links, kept through edits).
 *
 * Notes: `(Person)-[:HAS_STATIONED_NOTE]->(Description {stayId})-[:ABOUT_PLACE]->(place)`.
 * A relationship can't point at a relationship, so the note carries the
 * stay's id; ABOUT_PLACE keeps it traversable from the place.
 *
 * Location and Station share some slugs, so a place is always addressed
 * as `<kind>:<slug>`.
 */

import { runCypher, runCypherTx, type Neo4jEnv } from './neo4j.ts'
import { findInvalidRole } from './role-scopes.ts'
import { periodError } from './period.ts'
import { STAY_NOTE, repointNoteStatements } from './edge-note.ts'

export type PlaceKind = 'location' | 'station'

export const PLACE_LABEL: Record<PlaceKind, string> = { location: 'Location', station: 'Station' }

export interface StayInput {
  id?:        string | null
  role?:      string | null
  startDate?: string | null
  endDate?:   string | null
}

/** One stay after validation, with both ends resolved. */
export interface Stay {
  id:         string | null
  personSlug: string
  placeKind:  PlaceKind
  placeSlug:  string
  role:       string | null
  startDate:  string | null
  endDate:    string | null
}

export function parsePlace(v: unknown): { kind: PlaceKind; slug: string } | null {
  if (typeof v !== 'string') return null
  const i = v.indexOf(':')
  const kind = v.slice(0, i)
  const slug = v.slice(i + 1)
  if (i < 0 || !slug || (kind !== 'location' && kind !== 'station')) return null
  return { kind, slug }
}

/**
 * Field checks shared by both sides. Partial dates compare by their known
 * part: 1943 – 1943-05 is fine, 1944 – 1943-05 is not.
 */
export function stayFieldError(s: StayInput): string | null {
  const period = periodError(s.startDate, s.endDate)
  if (period) return period
  if (s.id !== null && s.id !== undefined && (typeof s.id !== 'string' || !s.id)) return 'Ugyldig id'
  return null
}

interface OldStay {
  id:        string
  personSlug: string
  placeKind: PlaceKind
  placeSlug: string
  role:      string | null
  startDate: string | null
  endDate:   string | null
  state:     string | null
  sourceRef: string | null
}

/** Which existing stays a save replaces: all of one person's, or all at one place. */
export type StayScope =
  | { side: 'person'; personSlug: string }
  | { side: 'place';  placeKind: PlaceKind; placeSlug: string }

function scopeMatch(scope: StayScope): string {
  return scope.side === 'person'
    ? `(p:Person {slug: $personSlug})-[r:STATIONED_AT]->(pl)`
    : `(p:Person)-[r:STATIONED_AT]->(pl:${PLACE_LABEL[scope.placeKind]} {slug: $placeSlug})`
}

function scopeParams(scope: StayScope): Record<string, unknown> {
  return scope.side === 'person'
    ? { personSlug: scope.personSlug }
    : { placeSlug: scope.placeSlug }
}

/**
 * Replace every stay in `scope` with `stays`, atomically. Returns the
 * stay ids in input order (new stays get fresh ids).
 *
 * Unchanged stays keep their state; changed or new ones become
 * 'verified'. sourceRef always survives. Notes whose stay is gone are
 * deleted. Unknown people or places fail the whole save.
 */
export async function replaceStays(
  env:   Neo4jEnv,
  scope: StayScope,
  stays: Stay[],
): Promise<{ ids: string[] } | { error: string; status: number }> {
  const badRole = await findInvalidRole(env, 'stationed', stays.map(s => s.role))
  if (badRole) return { error: `Ukjent rolle for denne koblingen: ${badRole}`, status: 400 }

  const missing = await runCypher<{ ref: string }>(env, `
    UNWIND $refs AS ref
    OPTIONAL MATCH (p:Person {slug: ref.slug}) WHERE ref.kind = 'person'
    OPTIONAL MATCH (l:Location {slug: ref.slug}) WHERE ref.kind = 'location'
    OPTIONAL MATCH (s:Station {slug: ref.slug}) WHERE ref.kind = 'station'
    WITH ref WHERE p IS NULL AND l IS NULL AND s IS NULL
    RETURN ref.kind + ':' + ref.slug AS ref
  `, {
    refs: [
      ...new Map(stays.flatMap(s => [
        [`person:${s.personSlug}`, { kind: 'person', slug: s.personSlug }],
        [`${s.placeKind}:${s.placeSlug}`, { kind: s.placeKind, slug: s.placeSlug }],
      ])).values(),
    ],
  })
  if (missing.length) return { error: `Finnes ikke: ${missing.map(m => m.ref).join(', ')}`, status: 400 }

  const old = await runCypher<OldStay>(env, `
    MATCH ${scopeMatch(scope)}
    RETURN r.id AS id, p.slug AS personSlug,
           CASE WHEN pl:Station THEN 'station' ELSE 'location' END AS placeKind,
           pl.slug AS placeSlug, r.role AS role,
           r.startDate AS startDate, r.endDate AS endDate,
           r.state AS state, r.sourceRef AS sourceRef
  `, scopeParams(scope))
  const oldById = new Map(old.filter(o => o.id).map(o => [o.id, o]))

  const items = stays.map(s => {
    const prev = s.id ? oldById.get(s.id) : undefined
    const unchanged = !!prev
      && prev.personSlug === s.personSlug
      && prev.placeKind  === s.placeKind && prev.placeSlug === s.placeSlug
      && prev.role       === s.role
      && prev.startDate  === s.startDate && prev.endDate === s.endDate
    return {
      ...s,
      // An id not in this scope (stale client, or moved elsewhere) is not reused.
      id:        prev ? prev.id : crypto.randomUUID(),
      state:     unchanged ? (prev.state ?? 'verified') : 'verified',
      sourceRef: prev?.sourceRef ?? null,
    }
  })
  const ids = items.map(i => i.id)

  const create = (kind: PlaceKind) => `
    UNWIND [x IN $items WHERE x.placeKind = '${kind}'] AS s
    MATCH (p:Person {slug: s.personSlug})
    MATCH (pl:${PLACE_LABEL[kind]} {slug: s.placeSlug})
    CREATE (p)-[:STATIONED_AT {
      id: s.id, role: s.role, startDate: s.startDate, endDate: s.endDate,
      state: s.state, sourceRef: s.sourceRef
    }]->(pl)
  `
  const pruneNotes = scope.side === 'person'
    ? `MATCH (:Person {slug: $personSlug})-[:HAS_STATIONED_NOTE]->(d:Description)
       WHERE NOT d.stayId IN $ids DETACH DELETE d`
    : `MATCH (:Person)-[:HAS_STATIONED_NOTE]->(d:Description)-[:ABOUT_PLACE]->(:${PLACE_LABEL[scope.placeKind]} {slug: $placeSlug})
       WHERE NOT d.stayId IN $ids DETACH DELETE d`

  const params = { ...scopeParams(scope), items, ids }
  await runCypherTx(env, [
    { statement: `MATCH ${scopeMatch(scope)} DELETE r`, parameters: params },
    { statement: create('location'), parameters: params },
    { statement: create('station'),  parameters: params },
    // A kept stay may have changed person or place; its note follows the edge.
    ...repointNoteStatements(STAY_NOTE).map(statement => ({ statement, parameters: params })),
    { statement: pruneNotes,         parameters: params },
  ])
  return { ids }
}
