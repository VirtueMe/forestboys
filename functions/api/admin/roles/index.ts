/**
 * /api/admin/roles
 *
 *   GET  — every Role with its scopes, per-scope usage counts (the
 *          scope → edge mapping lives server-side in role-scopes.ts) and
 *          whether it has a description yet.
 *   POST — create a Role. Body: { key, name, scopes, attended? }.
 *
 * The description is a Description node (HAS_CONTENT), edited through
 * /api/admin/roles/:key/sections like any entity description.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'
import { ROLE_SCOPES, KEY_RE, usageCypher, parseScopes, parseAttended } from '~/_lib/role-scopes.ts'

interface Env extends Neo4jEnv { SESSION_SECRET: string }

interface RoleRow {
  key:    string
  name:   string
  scopes: string[]
  /** Links with this role are shown under «Har deltatt på». */
  attended: boolean
  usage:  Record<string, number>
  hasDescription: boolean
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  try {
    const rows = await runCypher<RoleRow>(env, `
      MATCH (r:Role)
      RETURN r.key AS key, r.name AS name, coalesce(r.scopes, []) AS scopes,
             coalesce(r.attended, false) AS attended,
             ${usageCypher('r.key')} AS usage,
             EXISTS { (r)-[:HAS_CONTENT]->(:Description) } AS hasDescription
      ORDER BY toLower(r.name)
    `)
    return json({ ok: true, roles: rows, scopes: ROLE_SCOPES })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const body = await request.json<{ key?: unknown; name?: unknown; scopes?: unknown; attended?: unknown }>().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)

  const key = body.key
  if (typeof key !== 'string' || !KEY_RE.test(key)) return json({ error: 'key må være små bokstaver, tall og bindestrek' }, 400)
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return json({ error: 'name må være en tekst' }, 400)
  const scopes = parseScopes(body.scopes)
  if ('error' in scopes) return json({ error: scopes.error }, 400)
  const attended = parseAttended(body.attended, scopes.list)
  if ('error' in attended) return json({ error: attended.error }, 400)

  try {
    const [hit] = await runCypher<{ exists: boolean }>(env,
      `OPTIONAL MATCH (r:Role {key: $key}) RETURN r IS NOT NULL AS exists`, { key })
    if (hit?.exists) return json({ error: `Nøkkelen finnes allerede: ${key}` }, 409)

    await runCypher(env, `CREATE (:Role {key: $key, name: $name, scopes: $scopes, attended: $attended})`,
      { key, name, scopes: scopes.list, attended: attended.attended })
    return json({ ok: true, key })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
