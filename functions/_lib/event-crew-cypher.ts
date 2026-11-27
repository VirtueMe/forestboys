/**
 * Cypher shared with scripts/ — no imports, so a script can load it.
 *
 * A crew assignment only means something while the person is among the event's people and the event uses the
 * transport. Every write that can break one of those runs this afterwards (event crew, functions/_lib/event-crew.ts).
 */
export const DROP_STRAY_CREW = `
  MATCH (a:CrewAssignment)
  OPTIONAL MATCH (p:Person)-[:SERVED_AS]->(a)
  OPTIONAL MATCH (a)-[:ON_EVENT]->(e)
  OPTIONAL MATCH (a)-[:ABOARD]->(t:Transport)
  WITH a, p, e, t
  WHERE p IS NULL OR e IS NULL OR t IS NULL
     OR NOT EXISTS { (e)-[:USED]->(t) }
     OR NOT EXISTS { (p)-[:PARTICIPATED_IN|INVOLVED_IN]->(e) }
  DETACH DELETE a`
