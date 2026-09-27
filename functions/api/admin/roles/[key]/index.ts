/**
 * /api/admin/roles/:key
 *
 *   PATCH  — update name and/or scopes. Removing a scope that edges still
 *            use is refused (409) with the count, so no edge ends up
 *            carrying a role its relation no longer offers.
 *   DELETE — remove the Role and its description, only if no edge in any
 *            scope uses it.
 *
 * The key is immutable: edges store it (`role: '<key>'`).
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'
import { usageCypher, parseScopes } from '~/_lib/role-scopes.ts'

interface Env extends Neo4jEnv { SESSION_SECRET: string }

async function loadUsage(env: Env, key: string): Promise<Record<string, number> | null> {
  const [row] = await runCypher<{ usage: Record<string, number> }>(env, `
    MATCH (r:Role {key: $key})
    RETURN ${usageCypher('r.key')} AS usage
  `, { key })
  return row?.usage ?? null
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const key  = String(params.key)
  const body = await request.json<{ name?: unknown; scopes?: unknown }>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)

  const props: Record<string, unknown> = {}
  if ('name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return json({ error: 'name må være en tekst' }, 400)
    props.name = name
  }
  if ('scopes' in body) {
    const scopes = parseScopes(body.scopes)
    if ('error' in scopes) return json({ error: scopes.error }, 400)
    props.scopes = scopes.list
  }
  if (!Object.keys(props).length) return json({ ok: true, unchanged: true })

  try {
    const usage = await loadUsage(env, key)
    if (!usage) return json({ error: 'Role not found' }, 404)

    if (props.scopes) {
      const kept = props.scopes as string[]
      const blocked = Object.entries(usage).filter(([scope, n]) => n > 0 && !kept.includes(scope))
      if (blocked.length) {
        return json({ error: 'Gruppen er i bruk', blocked: Object.fromEntries(blocked) }, 409)
      }
    }

    const [row] = await runCypher<{ key: string; name: string; scopes: string[] }>(env, `
      MATCH (r:Role {key: $key})
      SET r += $props
      RETURN r.key AS key, r.name AS name, r.scopes AS scopes
    `, { key, props })
    return json({ ok: true, ...row, usage })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const key = String(params.key)
  try {
    const usage = await loadUsage(env, key)
    if (!usage) return json({ error: 'Role not found' }, 404)
    const total = Object.values(usage).reduce((a, b) => a + b, 0)
    if (total > 0) return json({ error: 'Rollen er i bruk', usage }, 409)

    await runCypher(env, `
      MATCH (r:Role {key: $key})
      OPTIONAL MATCH (r)-[:HAS_CONTENT]->(d:Description)
      DETACH DELETE d, r
    `, { key })
    return json({ ok: true, key })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
