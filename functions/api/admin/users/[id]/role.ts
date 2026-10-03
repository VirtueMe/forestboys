/**
 * POST /api/admin/users/:id/role — approve, deny or change an account.
 * Body: { role: 'pending' | 'editor' | 'admin' | 'denied' }. :id is the
 * account id, e.g. `github:101579` (URL-encoded).
 *
 * Takes effect on the user's next request: the role is read from D1, not
 * from their session cookie (functions/_lib/current-user.ts). The last
 * administrator cannot be demoted.
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { setUserRole }  from '~/_lib/users.ts'

interface Env {
  SESSION_SECRET: string
  milorg_users:   D1Database
}

export const onRequestPost: PagesFunction<Env, 'id'> = async ({ request, env, params }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  const id = Array.isArray(params.id) ? params.id[0] : params.id
  const body = await request.json<{ role?: unknown }>().catch(() => null)
  if (!id || !body) return json({ error: 'Ugyldig forespørsel.' }, 400)

  try {
    const result = await setUserRole(env.milorg_users, decodeURIComponent(id), body.role)
    return result.ok ? json({ ok: true }) : json({ error: result.error }, result.status)
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
