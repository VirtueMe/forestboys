/**
 * PATCH /api/admin/incident/:slug/persons — replace INVOLVED_IN edges from
 * the Incident side.
 *
 * Body: { persons: [{ personSlug }] }
 *
 * Inverse of /api/admin/person/:slug/incidents — mirrors the replace-all
 * semantics but pivots on the Incident rather than the Person.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import type { Neo4jEnv } from '~/_lib/neo4j.ts'
import { saveEdgeSet } from '~/_lib/edge-set.ts'

interface Env extends Neo4jEnv {
  SESSION_SECRET: string
}

interface PersonInput {
  personSlug: string
}

interface Body {
  persons?: PersonInput[]
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const slug = String(params.slug)
  const body = await request.json<Body>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)
  const persons = body.persons
  if (!Array.isArray(persons)) return json({ error: 'persons must be an array' }, 400)

  for (const p of persons) {
    if (typeof p.personSlug !== 'string' || !p.personSlug) {
      return json({ error: 'Bad personSlug' }, 400)
    }
  }

  try {
    await saveEdgeSet(env, {
      anchor: { label: 'Incident', slug }, rel: 'INVOLVED_IN', direction: 'in', targetLabel: 'Person',
      items: persons.map(p => ({ slug: p.personSlug })),
    })

    return json({ ok: true, count: persons.length })
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
