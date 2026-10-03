/**
 * GET /auth/google?next=/path — redirect to Google OAuth consent screen,
 * with a state value the callback checks (functions/_lib/oauth.ts).
 */

import { newState } from '../_lib/oauth.ts'

interface Env {
  GOOGLE_CLIENT_ID: string
}

export const onRequestGet: PagesFunction<Env> = ({ request, env }) => {
  const url = new URL(request.url)
  const redirectUri = `${url.origin}/auth/callback`
  const { state, cookie } = newState('google', url.searchParams.get('next') ?? '/')

  const params = new URLSearchParams({
    client_id:     env.GOOGLE_CLIENT_ID,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         'openid email profile',
    access_type:   'online',
    state,
  })

  return new Response(null, {
    status: 302,
    headers: { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, 'Set-Cookie': cookie },
  })
}
