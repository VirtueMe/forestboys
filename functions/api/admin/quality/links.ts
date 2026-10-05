/**
 * GET /api/admin/quality/links — descriptions with a link that leads nowhere.
 *
 * Reads every Description that has a link in it, checks each link against the
 * slugs that exist (src/utils/linkCheck.ts) and returns the ones that are not
 * fine. Computed on every call: a row disappears when the link is fixed.
 *
 * → { rows: AuditRow[], scanned, checked }   (see functions/_lib/link-audit.ts)
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'
import { auditDescriptions, type DescriptionRow } from '~/_lib/link-audit.ts'
import { KIND_ROUTES } from '../../../../src/utils/slugResolver.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

const KINDS = Object.keys(KIND_ROUTES).map(l => `n:${l}`).join(' OR ')

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  try {
    const slugs = await runCypher<{ label: string; slug: string }>(env, `
      MATCH (n) WHERE n.slug IS NOT NULL AND (${KINDS})
      RETURN labels(n)[0] AS label, n.slug AS slug
    `, {}, 'Read')

    // Only descriptions that can hold a link: the rest is not worth sending.
    const descriptions = await runCypher<DescriptionRow>(env, `
      MATCH (n)-[:HAS_CONTENT|HAS_INCIDENT_NOTE|HAS_OPERATION_NOTE]->(d:Description)
      WHERE d.content CONTAINS '"href"' OR d.content CONTAINS '"person"'
      RETURN labels(n)[0] AS label, n.slug AS slug,
             coalesce(n.name, n.title, n.codeName, n.slug) AS name,
             d.id AS descId, d.order AS order, d.content AS content
    `, {}, 'Read')

    return json(auditDescriptions(slugs, descriptions))
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
