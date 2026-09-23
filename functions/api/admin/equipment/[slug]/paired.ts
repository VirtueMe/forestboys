/**
 * PATCH /api/admin/equipment/:slug/paired — replace the EquipmentType's
 * PAIRED_WITH set.
 *
 * Body: { paired: [{ equipmentSlug: string }, ...] }
 *
 * PAIRED_WITH is symmetric (Eureka ↔ Rebecca): pieces that only work
 * together. It's stored as a single directed edge per pair and read in
 * both directions, so this drops every PAIRED_WITH touching the node —
 * whichever way it points — and recreates one outgoing edge per entry.
 * Unknown slugs and self-pairing are skipped.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'

interface Env extends Neo4jEnv { SESSION_SECRET: string }

interface Body { paired?: Array<{ equipmentSlug?: unknown }> }

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const slug = String(params.slug)
  const body = await request.json<Body>().catch(() => null)
  if (!body || !Array.isArray(body.paired)) return json({ error: 'paired must be an array' }, 400)

  const targets: string[] = []
  for (const p of body.paired) {
    if (typeof p.equipmentSlug !== 'string' || !p.equipmentSlug) return json({ error: 'Bad equipmentSlug' }, 400)
    if (p.equipmentSlug !== slug && !targets.includes(p.equipmentSlug)) targets.push(p.equipmentSlug)
  }

  try {
    const [hit] = await runCypher<{ exists: boolean }>(env,
      `OPTIONAL MATCH (e:EquipmentType {slug: $slug}) RETURN e IS NOT NULL AS exists`, { slug })
    if (!hit?.exists) return json({ error: 'EquipmentType not found' }, 404)

    await runCypher(env, `
      MATCH (e:EquipmentType {slug: $slug})-[r:PAIRED_WITH]-(:EquipmentType)
      DELETE r
    `, { slug })

    if (targets.length) {
      await runCypher(env, `
        MATCH (e:EquipmentType {slug: $slug})
        UNWIND $targets AS t
        MATCH (other:EquipmentType {slug: t})
        CREATE (e)-[:PAIRED_WITH]->(other)
      `, { slug, targets })
    }

    return json({ ok: true, count: targets.length })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
