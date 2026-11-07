/**
 * Guard for content endpoints that editors may use as well as admins (#414). `admin` is site
 * configuration (users, settings, roles); changing content is what an editor does.
 * Same shape as requireAdmin: the user, or a 401/403 Response to return.
 */

import { resolveUser, type UserEnv } from './current-user.ts'
import type { SessionUser }            from './session.ts'

export async function requireEditor(
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
  if (user.role !== 'admin' && user.role !== 'editor') {
    return new Response(JSON.stringify({ error: 'Editors only' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return user
}
