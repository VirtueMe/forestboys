/**
 * GET /auth/me — return current session user or 401
 */

import { readSession } from '../_lib/session.ts'

interface Env {
  SESSION_SECRET: string
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
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
