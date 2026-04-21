/**
 * PATCH /api/admin/event/:slug/kind — flip a node between Incident and Operation.
 *
 * Body: { kind: 'incident' | 'operation' }
 *
 * Runs the full rewrite in one transaction:
 *   • label           Incident ↔ Operation
 *   • name property   title ↔ codeName
 *   • person edges    INVOLVED_IN ↔ PARTICIPATED_IN
 *   • desc notes      HAS_INCIDENT_NOTE ↔ HAS_OPERATION_NOTE
 *   • desc about      ABOUT_INCIDENT ↔ ABOUT_OPERATION
 *   • hierarchy       PART_OF ↔ OCCURRED_IN (edge type flips based on kinds on both ends)
 *
 * Promotion refuses if an outgoing `X-[:PART_OF]->parent:Incident` exists
 * (would become illegal Operation→PART_OF→Incident).
 * Demotion refuses if any `(other:Operation)-[:PART_OF]->X` exists
 * (would become illegal Operation→PART_OF→Incident).
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

interface Body {
  kind?: 'incident' | 'operation'
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const slug = String(params.slug)
  const body = await request.json<Body>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)
  const target = body.kind
  if (target !== 'incident' && target !== 'operation') {
    return json({ error: "kind must be 'incident' or 'operation'" }, 400)
  }

  try {
    const [current] = await runCypher<{ kind: string | null }>(env, `
      MATCH (n {slug: $slug})
      WHERE n:Incident OR n:Operation
      RETURN CASE WHEN 'Incident' IN labels(n) THEN 'incident'
                  WHEN 'Operation' IN labels(n) THEN 'operation'
                  ELSE NULL END AS kind
    `, { slug })

    if (!current?.kind) return json({ error: 'Node not found or not an Incident/Operation' }, 404)
    if (current.kind === target) return json({ ok: true, kind: target, unchanged: true })

    if (target === 'operation') {
      // Promote Incident → Operation.
      // Block if X is itself PART_OF another Incident (op-in-incident would be illegal).
      const [blocker] = await runCypher<{ parentSlug: string }>(env, `
        MATCH (x:Incident {slug: $slug})-[:PART_OF]->(parent:Incident)
        RETURN parent.slug AS parentSlug LIMIT 1
      `, { slug })
      if (blocker) {
        return json({
          error: `Can't promote: this Incident is PART_OF Incident "${blocker.parentSlug}". Detach first, or promote the parent too.`,
        }, 409)
      }

      await runCypher(env, `
        MATCH (x:Incident {slug: $slug})
        // Node label + name property
        REMOVE x:Incident
        SET x:Operation
        SET x.codeName = coalesce(x.codeName, x.title)
        REMOVE x.title
        WITH x
        // Incoming INVOLVED_IN → PARTICIPATED_IN
        CALL {
          WITH x
          MATCH (p:Person)-[r:INVOLVED_IN]->(x)
          CREATE (p)-[:PARTICIPATED_IN]->(x)
          DELETE r
          RETURN count(*) AS _
        }
        // Incoming ABOUT_INCIDENT → ABOUT_OPERATION (+ rename the note edge on Person→Description)
        CALL {
          WITH x
          MATCH (p:Person)-[noteR:HAS_INCIDENT_NOTE]->(d:Description)-[aboutR:ABOUT_INCIDENT]->(x)
          CREATE (p)-[:HAS_OPERATION_NOTE]->(d)
          CREATE (d)-[:ABOUT_OPERATION]->(x)
          DELETE noteR, aboutR
          RETURN count(*) AS _
        }
        // Incoming child Incidents: PART_OF (same-kind) → OCCURRED_IN (cross-kind)
        CALL {
          WITH x
          MATCH (y:Incident)-[r:PART_OF]->(x)
          CREATE (y)-[:OCCURRED_IN]->(x)
          DELETE r
          RETURN count(*) AS _
        }
        // Outgoing OCCURRED_IN (incident-in-op) → PART_OF (op-in-op, same-kind)
        CALL {
          WITH x
          MATCH (x)-[r:OCCURRED_IN]->(parentOp:Operation)
          CREATE (x)-[:PART_OF]->(parentOp)
          DELETE r
          RETURN count(*) AS _
        }
      `, { slug })

      return json({ ok: true, kind: 'operation' })
    }

    // Demote Operation → Incident.
    // Block if any Operation is PART_OF X (op-in-op nesting can't demote parent).
    const [blocker] = await runCypher<{ childSlug: string }>(env, `
      MATCH (other:Operation)-[:PART_OF]->(x:Operation {slug: $slug})
      RETURN other.slug AS childSlug LIMIT 1
    `, { slug })
    if (blocker) {
      return json({
        error: `Can't demote: Operation "${blocker.childSlug}" is PART_OF this node. Detach or demote it first.`,
      }, 409)
    }

    await runCypher(env, `
      MATCH (x:Operation {slug: $slug})
      REMOVE x:Operation
      SET x:Incident
      SET x.title = coalesce(x.title, x.codeName)
      REMOVE x.codeName
      WITH x
      // Incoming PARTICIPATED_IN → INVOLVED_IN
      CALL {
        WITH x
        MATCH (p:Person)-[r:PARTICIPATED_IN]->(x)
        CREATE (p)-[:INVOLVED_IN]->(x)
        DELETE r
        RETURN count(*) AS _
      }
      // Incoming ABOUT_OPERATION → ABOUT_INCIDENT
      CALL {
        WITH x
        MATCH (p:Person)-[noteR:HAS_OPERATION_NOTE]->(d:Description)-[aboutR:ABOUT_OPERATION]->(x)
        CREATE (p)-[:HAS_INCIDENT_NOTE]->(d)
        CREATE (d)-[:ABOUT_INCIDENT]->(x)
        DELETE noteR, aboutR
        RETURN count(*) AS _
      }
      // Incoming child Incidents: OCCURRED_IN → PART_OF (same-kind, both Incident)
      CALL {
        WITH x
        MATCH (y:Incident)-[r:OCCURRED_IN]->(x)
        CREATE (y)-[:PART_OF]->(x)
        DELETE r
        RETURN count(*) AS _
      }
      // Outgoing PART_OF (op-in-op) → OCCURRED_IN (incident-in-op)
      CALL {
        WITH x
        MATCH (x)-[r:PART_OF]->(parentOp:Operation)
        CREATE (x)-[:OCCURRED_IN]->(parentOp)
        DELETE r
        RETURN count(*) AS _
      }
    `, { slug })

    return json({ ok: true, kind: 'incident' })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
