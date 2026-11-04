/**
 * PATCH /api/admin/outline/:slug/people — replace the people an Outline mentions
 * ((:Outline)-[:MENTIONS]->(:Person)). A plain link: no role, date or order.
 *
 * The body lists person slugs. The save is a difference (`saveEdgeSet`): a person still
 * in the list keeps their edge, new ones get `state: 'verified', sourceRef: 'admin-edit'`,
 * the rest go. The Sanity outline sync only adds MENTIONS, so it never undoes a removal.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'
import { saveEdgeSet } from '~/_lib/edge-set.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

interface Body { people?: unknown }

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const slug = String(params.slug)
  const body = await request.json<Body>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)
  const people = body.people
  if (!Array.isArray(people)) return json({ error: 'people must be an array' }, 400)
  for (const p of people) {
    if (typeof p !== 'string' || !p) return json({ error: 'Bad person slug' }, 400)
  }
  const slugs = [...new Set(people as string[])]

  try {
    const [row] = await runCypher<{ found: boolean; known: string[] }>(env, `
      OPTIONAL MATCH (o:Outline {slug: $slug})
      WITH o
      OPTIONAL MATCH (p:Person) WHERE p.slug IN $slugs
      RETURN o IS NOT NULL AS found, collect(DISTINCT p.slug) AS known`,
      { slug, slugs }, 'Read')
    if (!row?.found) return json({ error: 'Outline not found' }, 404)
    const unknown = slugs.filter(s => !row.known.includes(s))
    if (unknown.length) return json({ error: `Ukjent person: ${unknown.join(', ')}` }, 400)

    await saveEdgeSet(env, {
      anchor: { label: 'Outline', slug }, rel: 'MENTIONS', direction: 'out', targetLabel: 'Person',
      items: slugs.map(s => ({ slug: s })),
    })

    return json({ ok: true, count: slugs.length })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
