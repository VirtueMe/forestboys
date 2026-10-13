/**
 * GET /api/admin/quality/html — descriptions with broken structure inside their blocks (#128).
 *
 * Reads every Description with content, checks its blocks (src/utils/blockCheck.ts) and returns
 * the findings. Computed on every call: a row disappears when it is fixed. It only shows; the
 * editor fixes.
 *
 * → { rows: BlockAuditRow[], scanned }   (see functions/_lib/block-audit.ts)
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'
import { auditBlocks, type SectionRow } from '~/_lib/block-audit.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  try {
    // The same descriptions as the links page; an empty one has nothing to check.
    const descriptions = await runCypher<SectionRow>(env, `
      MATCH (n)-[r:HAS_CONTENT|HAS_INCIDENT_NOTE|HAS_OPERATION_NOTE]->(d:Description)
      WHERE d.content IS NOT NULL AND d.content <> '' AND d.content <> '[]'
      OPTIONAL MATCH (p:Page)-[:HAS_CARD]->(n)
      RETURN labels(n)[0] AS label, n.slug AS slug,
             coalesce(n.name, n.title, n.codeName, n.slug) AS name,
             type(r) AS rel,
             d.id AS descId, d.order AS order, d.content AS content,
             p.slug AS pageSlug, CASE WHEN p IS NULL THEN null ELSE n.id END AS cardId
    `, {}, 'Read')

    return json(auditBlocks(descriptions))
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
