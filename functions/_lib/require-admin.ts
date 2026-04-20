/**
 * Guard for admin-only endpoints. Accepts either a Bearer JWT or the signed
 * session cookie (same as /auth/me). Returns the user on success, or a
 * Response to short-circuit the handler with 401/403.
 */

import { readSession, type SessionUser } from './session.ts'
import { verifyJwt }                     from './jwt.ts'

interface Env {
  SESSION_SECRET: string
}

export async function requireAdmin(
  request: Request,
  env:     Env,
): Promise<SessionUser | Response> {
  const bearer = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]

  let user: SessionUser | null = null
  if (bearer) {
    const claims = await verifyJwt(bearer, env.SESSION_SECRET)
    if (claims) user = { id: claims.sub, email: claims.email, name: claims.name, role: claims.role }
  }
  user ??= await readSession(request, env.SESSION_SECRET)

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
