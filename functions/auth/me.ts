/**
 * GET /auth/me — resolve the current user from either:
 *   1. Authorization: Bearer <JWT>   (direct-token path, /auth/token)
 *   2. Signed session cookie         (Google / GitHub OAuth, /auth/callback)
 *
 * For the cookie the role comes from D1, not the cookie, so an approval
 * applies at once (functions/_lib/current-user.ts).
 *
 * Returns 401 when neither is present or valid.
 */

import { resolveUser, type UserEnv } from '../_lib/current-user.ts'

export const onRequestGet: PagesFunction<UserEnv> = async ({ request, env }) => {
  const user = await resolveUser(request, env)
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
