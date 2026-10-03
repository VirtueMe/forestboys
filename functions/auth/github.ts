/**
 * GET /auth/github?next=/path — redirect to GitHub's OAuth consent screen.
 *
 * redirect_uri is built from this request's origin: the OAuth App's callback
 * (https://forestboys.pages.dev/auth/github/callback) has wildcard matching
 * on, so every preview subdomain is accepted too. Locally a second app with
 * the 127.0.0.1:8788 callback is used (.dev.vars).
 */

import { newState } from '../_lib/oauth.ts'

interface Env {
  GITHUB_CLIENT_ID: string
}

export const onRequestGet: PagesFunction<Env> = ({ request, env }) => {
  const url = new URL(request.url)
  const { state, cookie } = newState('github', url.searchParams.get('next') ?? '/')

  const params = new URLSearchParams({
    client_id:    env.GITHUB_CLIENT_ID,
    redirect_uri: `${url.origin}/auth/github/callback`,
    scope:        'read:user user:email',
    state,
    allow_signup: 'false',
  })

  return new Response(null, {
    status: 302,
    headers: { Location: `https://github.com/login/oauth/authorize?${params.toString()}`, 'Set-Cookie': cookie },
  })
}
