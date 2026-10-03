/**
 * Guard for admin-only endpoints. Accepts either a Bearer JWT or the signed
 * session cookie (same as /auth/me). Returns the user on success, or a
 * Response to short-circuit the handler with 401/403.
 */

import { resolveUser, type UserEnv } from './current-user.ts'
import type { SessionUser }            from './session.ts'

export async function requireAdmin(
  request: Request,
  env:     UserEnv,
): Promise<SessionUser | Response> {
  const user = await resolveUser(request, env)

  if (!user) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (user.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Admin only' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return user
}
