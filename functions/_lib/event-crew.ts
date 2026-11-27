/**
 * Event crew — who served on a transport during one Operation or Incident:
 *
 *   (:Person)-[:SERVED_AS]->(:CrewAssignment {id, role, state, sourceRef})-[:ON_EVENT]->(event)
 *                           (:CrewAssignment)-[:ABOARD]->(:Transport)
 *
 * A node, because the assignment joins three things. `role` is a Role key of the `crew` scope, or null; `order` is the
 * 1-based place in the list the editor saved. The regular
 * crew of a transport is CREW_OF (functions/_lib/crew.ts) and is not touched here.
 *
 * Adding someone as crew also makes them one of the event's people. Removing them from the crew leaves them there.
 */

import { runCypher, runCypherTx, type Neo4jEnv } from './neo4j.ts'
import { findInvalidRole } from './role-scopes.ts'
import { ADMIN_EDGE } from './edge-set.ts'

export interface EventCrewInput {
  id?:         string | null
  personSlug?: string
  role?:       string | null
}

const EVENT = `(e:Operation|Incident {slug: $event})`

/**
 * Replace the crew of one transport on one event with `crew`, atomically. Returns the assignment ids in input order.
 * A bad row fails the whole save.
 */
export async function replaceEventCrew(
  env:           Neo4jEnv,
  eventSlug:     string,
  transportSlug: string,
  crew:          EventCrewInput[],
): Promise<{ ids: string[] } | { error: string; status: number }> {
  for (const c of crew) {
    if (typeof c.personSlug !== 'string' || !c.personSlug) return { error: 'Bad personSlug', status: 400 }
    if (c.id !== null && c.id !== undefined && (typeof c.id !== 'string' || !c.id)) return { error: 'Ugyldig id', status: 400 }
  }
  const given = crew.flatMap(c => c.id ? [c.id] : [])
  if (new Set(given).size !== given.length) return { error: 'Samme id på to rader', status: 400 }
  if (new Set(crew.map(c => `${c.personSlug}\n${c.role || ''}`)).size !== crew.length) {
    return { error: 'Samme person med samme rolle står to ganger', status: 400 }
  }

  const badRole = await findInvalidRole(env, 'crew', crew.map(c => c.role))
  if (badRole) return { error: `Ukjent rolle for mannskap: ${badRole}`, status: 400 }

  const params = { event: eventSlug, transport: transportSlug }
  const found = await runCypher<{ label: string }>(env, `
    MATCH ${EVENT}-[:USED]->(:Transport {slug: $transport})
    RETURN CASE WHEN e:Operation THEN 'Operation' ELSE 'Incident' END AS label
  `, params, 'Read')
  if (!found.length) return { error: `Transportmiddelet ${transportSlug} er ikke knyttet til ${eventSlug}`, status: 404 }
  const personEdge = found[0].label === 'Operation' ? 'PARTICIPATED_IN' : 'INVOLVED_IN'

  const missing = await runCypher<{ slug: string }>(env, `
    UNWIND $slugs AS slug
    OPTIONAL MATCH (p:Person {slug: slug})
    WITH slug, p WHERE p IS NULL
    RETURN slug
  `, { slugs: [...new Set(crew.map(c => c.personSlug))] }, 'Read')
  if (missing.length) return { error: `Finnes ikke: ${missing.map(m => `person:${m.slug}`).join(', ')}`, status: 400 }

  const old = await runCypher<{ id: string; personSlug: string }>(env, `
    MATCH (p:Person)-[:SERVED_AS]->(a:CrewAssignment)-[:ON_EVENT]->${EVENT},
          (a)-[:ABOARD]->(:Transport {slug: $transport})
    RETURN a.id AS id, p.slug AS personSlug
  `, params, 'Read')
  const oldPerson = new Map(old.map(o => [o.id, o.personSlug]))

  const items = crew.map((c, i) => {
    // A row moved to another person is a new assignment; so is an id this list doesn't have.
    const kept = !!c.id && oldPerson.get(c.id) === c.personSlug
    return { kept, id: kept ? c.id! : crypto.randomUUID(), personSlug: c.personSlug!, role: c.role || null, order: i + 1 }
  })

  await runCypherTx(env, [
    {
      statement: `
        MATCH (a:CrewAssignment)-[:ON_EVENT]->${EVENT}, (a)-[:ABOARD]->(:Transport {slug: $transport})
        WHERE NOT a.id IN $keep
        DETACH DELETE a`,
      parameters: { ...params, keep: items.flatMap(i => i.kept ? [i.id] : []) },
    },
    {
      statement: `
        UNWIND [i IN $items WHERE i.kept] AS x
        MATCH (a:CrewAssignment {id: x.id})
        // A move alone is not a review of the claim; a changed role is. state is set while the old role is still there.
        SET a.state = CASE WHEN coalesce(a.role, '') = coalesce(x.role, '') THEN a.state ELSE 'verified' END
        SET a.role = x.role, a.order = x.order`,
      parameters: { items },
    },
    {
      statement: `
        MATCH ${EVENT}-[:USED]->(t:Transport {slug: $transport})
        UNWIND [i IN $items WHERE NOT i.kept] AS x
        MATCH (p:Person {slug: x.personSlug})
        CREATE (p)-[:SERVED_AS]->(a:CrewAssignment {id: x.id, role: x.role, order: x.order, state: 'verified', sourceRef: 'admin-edit'}),
               (a)-[:ON_EVENT]->(e), (a)-[:ABOARD]->(t)`,
      parameters: { ...params, items },
    },
    {
      // No `order`: someone added here sorts after the people the editor has placed.
      statement: `
        MATCH ${EVENT}
        UNWIND $slugs AS slug
        MATCH (p:Person {slug: slug})
        MERGE (p)-[r:\`${personEdge}\`]->(e)
          ON CREATE SET r = $created`,
      parameters: { event: eventSlug, slugs: [...new Set(items.map(i => i.personSlug))], created: ADMIN_EDGE },
    },
  ])
  return { ids: items.map(i => i.id) }
}
