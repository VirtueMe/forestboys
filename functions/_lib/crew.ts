/**
 * Crew — `(:Person)-[:CREW_OF]->(:Transport)`, one edge per stint: a person
 * can serve on the same transport twice, or change role.
 *
 * Edge properties: `id`, `role` (a Role key of the `crew` scope), `startDate`,
 * `endDate` (partial dates), `state`, `sourceRef`. Kept edges are updated in
 * place, so what the editor does not send survives a save. An edge without an
 * `id` is addressed by its element id and gets one on the first save.
 */

import { runCypher, runCypherTx, type Neo4jEnv } from './neo4j.ts'
import { findInvalidRole } from './role-scopes.ts'
import { periodError } from './period.ts'

export interface CrewInput {
  id?:         string | null
  personSlug?: string
  role?:       string | null
  startDate?:  string | null
  endDate?:    string | null
}

const KEY = 'coalesce(r.id, elementId(r))'

/**
 * Replace the crew of one transport with `crew`, atomically. Returns the edge
 * ids in input order. A bad row fails the whole save.
 */
export async function replaceCrew(
  env:           Neo4jEnv,
  transportSlug: string,
  crew:          CrewInput[],
): Promise<{ ids: string[] } | { error: string; status: number }> {
  for (const c of crew) {
    if (typeof c.personSlug !== 'string' || !c.personSlug) return { error: 'Bad personSlug', status: 400 }
    if (c.id !== null && c.id !== undefined && (typeof c.id !== 'string' || !c.id)) return { error: 'Ugyldig id', status: 400 }
    const period = periodError(c.startDate, c.endDate)
    if (period) return { error: period, status: 400 }
  }
  const given = crew.flatMap(c => c.id ? [c.id] : [])
  if (new Set(given).size !== given.length) return { error: 'Samme id på to rader', status: 400 }

  const badRole = await findInvalidRole(env, 'crew', crew.map(c => c.role))
  if (badRole) return { error: `Ukjent rolle for mannskap: ${badRole}`, status: 400 }

  const found = await runCypher<{ slug: string }>(env,
    `MATCH (t:Transport {slug: $slug}) RETURN t.slug AS slug`, { slug: transportSlug }, 'Read')
  if (!found.length) return { error: `Finnes ikke: transport:${transportSlug}`, status: 404 }
  const missing = await runCypher<{ slug: string }>(env, `
    UNWIND $slugs AS slug
    OPTIONAL MATCH (p:Person {slug: slug})
    WITH slug, p WHERE p IS NULL
    RETURN slug
  `, { slugs: [...new Set(crew.map(c => c.personSlug))] }, 'Read')
  if (missing.length) return { error: `Finnes ikke: ${missing.map(m => `person:${m.slug}`).join(', ')}`, status: 400 }

  const old = await runCypher<{ id: string; personSlug: string }>(env, `
    MATCH (p:Person)-[r:CREW_OF]->(:Transport {slug: $slug})
    RETURN ${KEY} AS id, p.slug AS personSlug
  `, { slug: transportSlug }, 'Read')
  const oldPerson = new Map(old.map(o => [o.id, o.personSlug]))

  const items = crew.map(c => {
    // A row moved to another person is a new edge; so is an id this transport doesn't have.
    const kept = !!c.id && oldPerson.get(c.id) === c.personSlug
    return {
      key:        kept ? c.id! : null,
      // An element id is not stable enough to store; a real id is kept as it is.
      id:         kept && !c.id!.includes(':') ? c.id! : crypto.randomUUID(),
      personSlug: c.personSlug!,
      role:       c.role      || null,
      startDate:  c.startDate || null,
      endDate:    c.endDate   || null,
    }
  })
  const keys = items.flatMap(i => i.key ? [i.key] : [])
  const same = (prop: string) => `coalesce(r.${prop}, '') = coalesce(x.${prop}, '')`

  await runCypherTx(env, [
    {
      statement:  `MATCH (:Person)-[r:CREW_OF]->(:Transport {slug: $slug}) WHERE NOT ${KEY} IN $keys DELETE r`,
      parameters: { slug: transportSlug, keys },
    },
    {
      // `state` is set first, while the edge still holds the old values.
      statement: `
        UNWIND [i IN $items WHERE i.key IS NOT NULL] AS x
        MATCH (:Person {slug: x.personSlug})-[r:CREW_OF]->(:Transport {slug: $slug}) WHERE ${KEY} = x.key
        SET r.state = CASE WHEN ${same('role')} AND ${same('startDate')} AND ${same('endDate')}
                           THEN coalesce(r.state, 'verified') ELSE 'verified' END
        SET r.id = x.id, r.role = x.role, r.startDate = x.startDate, r.endDate = x.endDate`,
      parameters: { slug: transportSlug, items },
    },
    {
      statement: `
        MATCH (t:Transport {slug: $slug})
        UNWIND [i IN $items WHERE i.key IS NULL] AS x
        MATCH (p:Person {slug: x.personSlug})
        CREATE (p)-[:CREW_OF {
          id: x.id, role: x.role, startDate: x.startDate, endDate: x.endDate,
          state: 'verified', sourceRef: 'admin-edit'
        }]->(t)`,
      parameters: { slug: transportSlug, items },
    },
  ])
  return { ids: items.map(i => i.id) }
}
