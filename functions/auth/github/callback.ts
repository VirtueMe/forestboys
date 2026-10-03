/**
 * GET /auth/github/callback — check state, exchange the code, read the user
 * and their verified primary email, then sign in (functions/_lib/oauth.ts).
 *
 * The profile email may be private or unverified, so the email comes from
 * /user/emails (scope user:email): the primary one, and only if verified.
 */

import { accessError, checkState, signIn, type OAuthEnv } from '../../_lib/oauth.ts'

interface Env extends OAuthEnv {
  GITHUB_CLIENT_ID:     string
  GITHUB_CLIENT_SECRET: string
}

interface GitHubUser  { id: number; login: string; name: string | null }
interface GitHubEmail { email: string; primary: boolean; verified: boolean }

const API_HEADERS = (token: string) => ({
  'Authorization':        `Bearer ${token}`,
  'Accept':               'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent':           'milorg-forestboys',
})

/** A failed step: log it for the Pages logs and give /access a short code to show.
 *  `detail` is GitHub's own error code or an HTTP status, never a secret. */
function failed(step: string, detail: string): Response {
  console.error(`github sign-in failed at ${step}: ${detail}`)
  return accessError('failed', { detail: `${step}:${detail}` })
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    return await signInWithGitHub(request, env)
  } catch (err) {
    console.error('github sign-in threw', err)
    return failed('exception', err instanceof Error ? err.name : 'unknown')
  }
}

async function signInWithGitHub(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  if (url.searchParams.get('error')) return accessError('denied')   // the user declined at GitHub

  const state = checkState(request, 'github')
  if (!state.ok) return accessError('state')

  const code = url.searchParams.get('code')
  if (!code) return failed('code', 'missing')

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method:  'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'milorg-forestboys' },
    body: JSON.stringify({
      client_id:     env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri:  `${url.origin}/auth/github/callback`,
    }),
  })
  const token = await tokenRes.json().catch(() => ({})) as { access_token?: string; error?: string }
  if (!tokenRes.ok || !token.access_token) return failed('token', token.error ?? `http_${tokenRes.status}`)

  const [userRes, emailsRes] = await Promise.all([
    fetch('https://api.github.com/user',        { headers: API_HEADERS(token.access_token) }),
    fetch('https://api.github.com/user/emails', { headers: API_HEADERS(token.access_token) }),
  ])
  if (!userRes.ok)   return failed('user',   `http_${userRes.status}`)
  if (!emailsRes.ok) return failed('emails', `http_${emailsRes.status}`)
  const user   = await userRes.json<GitHubUser>()
  const emails = await emailsRes.json<GitHubEmail[]>()

  const primary = emails.find(e => e.primary && e.verified)
  if (!primary) return accessError('unverified')

  return signIn(env, {
    provider:   'github',
    providerId: String(user.id),
    email:      primary.email,
    name:       user.name || user.login,
  }, state.next)
}
