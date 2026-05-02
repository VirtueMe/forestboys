/**
 * PATCH /api/admin/event/:slug/kind — flip a node between Incident and Operation.
 *
 * Body: { kind: 'incident' | 'operation' }
 *
 * Runs the rewrite in one transaction:
 *   • label           Incident ↔ Operation
 *   • name property   title ↔ codeName
 *   • person edges    INVOLVED_IN ↔ PARTICIPATED_IN
 *   • desc notes      HAS_INCIDENT_NOTE ↔ HAS_OPERATION_NOTE
 *   • desc about      ABOUT_INCIDENT ↔ ABOUT_OPERATION
 *
 * Hierarchy edges (RELATED_TO {kind:'contains'}) survive the flip
 * unchanged — direction is container→child regardless of node kind.
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
      await runCypher(env, `
        MATCH (x:Incident {slug: $slug})
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
      `, { slug })

      return json({ ok: true, kind: 'operation' })
    }

    // Demote Operation → Incident.
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
