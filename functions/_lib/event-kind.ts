/**
 * Incident ↔ Operation flip — shared by PATCH /api/admin/event/:slug/kind,
 * the bundle op `set-kind` and scripts/migrations/migrate-events-to-operation.ts.
 *
 * One statement per direction, over a list of slugs ($slugs):
 *   • label           Incident ↔ Operation
 *   • name property   title ↔ codeName
 *   • person edges    INVOLVED_IN ↔ PARTICIPATED_IN (properties kept — the
 *                     Sanity sync reads their sourceRef)
 *   • desc notes      HAS_INCIDENT_NOTE ↔ HAS_OPERATION_NOTE
 *   • desc about      ABOUT_INCIDENT ↔ ABOUT_OPERATION
 *
 * Demotion also strips ORCHESTRATED_BY and Unit PARTICIPATED_IN (incidents
 * inherit org/unit context) — callers check DEMOTE_BLOCKERS first unless
 * forced. Hierarchy edges (RELATED_TO {kind:'contains'}) are kind-agnostic
 * and survive unchanged.
 */

export const PROMOTE_TO_OPERATION = `
  UNWIND $slugs AS slug
  MATCH (x:Incident {slug: slug})
  REMOVE x:Incident
  SET x:Operation
  SET x.codeName = coalesce(x.codeName, x.title)
  REMOVE x.title
  WITH x
  CALL {
    WITH x
    MATCH (p:Person)-[r:INVOLVED_IN]->(x)
    CREATE (p)-[n:PARTICIPATED_IN]->(x) SET n = properties(r)
    DELETE r
    RETURN count(*) AS personEdges
  }
  CALL {
    WITH x
    MATCH (p:Person)-[noteR:HAS_INCIDENT_NOTE]->(d:Description)-[aboutR:ABOUT_INCIDENT]->(x)
    CREATE (p)-[n1:HAS_OPERATION_NOTE]->(d) SET n1 = properties(noteR)
    CREATE (d)-[n2:ABOUT_OPERATION]->(x) SET n2 = properties(aboutR)
    DELETE noteR, aboutR
    RETURN count(*) AS noteEdges
  }
  RETURN count(x) AS flipped`

export const DEMOTE_BLOCKERS = `
  UNWIND $slugs AS slug
  MATCH (x:Operation {slug: slug})
  RETURN x.slug AS slug,
         [(x)-[:ORCHESTRATED_BY]->(o:Organization) | {slug: o.slug, name: o.canonicalName}] AS orgs,
         [(u:Unit)-[:PARTICIPATED_IN]->(x) | {slug: u.slug, name: u.canonicalName}] AS units`

export const DEMOTE_TO_INCIDENT = `
  UNWIND $slugs AS slug
  MATCH (x:Operation {slug: slug})
  REMOVE x:Operation
  SET x:Incident
  SET x.title = coalesce(x.title, x.codeName)
  REMOVE x.codeName
  WITH x
  CALL {
    WITH x
    MATCH (p:Person)-[r:PARTICIPATED_IN]->(x)
    CREATE (p)-[n:INVOLVED_IN]->(x) SET n = properties(r)
    DELETE r
    RETURN count(*) AS personEdges
  }
  CALL {
    WITH x
    MATCH (x)-[r:ORCHESTRATED_BY]->(:Organization) DELETE r
    RETURN count(*) AS orgEdges
  }
  CALL {
    WITH x
    MATCH (:Unit)-[r:PARTICIPATED_IN]->(x) DELETE r
    RETURN count(*) AS unitEdges
  }
  CALL {
    WITH x
    MATCH (p:Person)-[noteR:HAS_OPERATION_NOTE]->(d:Description)-[aboutR:ABOUT_OPERATION]->(x)
    CREATE (p)-[n1:HAS_INCIDENT_NOTE]->(d) SET n1 = properties(noteR)
    CREATE (d)-[n2:ABOUT_INCIDENT]->(x) SET n2 = properties(aboutR)
    DELETE noteR, aboutR
    RETURN count(*) AS noteEdges
  }
  RETURN count(x) AS flipped`
