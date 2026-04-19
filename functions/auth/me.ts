/**
 * GET /auth/me — resolve the current user from either:
 *   1. Authorization: Bearer <JWT>   (direct-token path, /auth/token)
 *   2. Signed session cookie         (Google OAuth path, /auth/callback)
 *
 * Returns 401 when neither is present or valid.
 */

import { readSession } from '../_lib/session.ts'
import { verifyJwt }   from '../_lib/jwt.ts'

interface Env {
  SESSION_SECRET: string
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = request.headers.get('Authorization') ?? ''
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]
  if (bearer) {
    const claims = await verifyJwt(bearer, env.SESSION_SECRET)
    if (claims) {
      return new Response(JSON.stringify({
        id:    claims.sub,
        email: claims.email,
        name:  claims.name,
        role:  claims.role,
      }), { headers: { 'Content-Type': 'application/json' } })
    }
  }

  const user = await readSession(request, env.SESSION_SECRET)
  if (!user) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return new Response(JSON.stringify(user), {
    headers: { 'Content-Type': 'application/json' },
  })
}
