/**
 * GET /api/admin/users — every account with its role, pending requests first,
 * plus how many requests are waiting (for the badge in the admin menu).
 */

import { requireAdmin } from '~/_lib/require-admin.ts'
import { listUsers }    from '~/_lib/users.ts'

interface Env {
  SESSION_SECRET: string
  milorg_users:   D1Database
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const guard = await requireAdmin(request, env)
  if (guard instanceof Response) return guard

  try {
    const users = await listUsers(env.milorg_users)
    return json({ ok: true, users, pending: users.filter(u => u.role === 'pending').length })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
