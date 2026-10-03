/**
 * GET /auth/callback — Google: check state, exchange the code, read the
 * user, then sign in (functions/_lib/oauth.ts). Only a verified email is
 * accepted — admin rights hang on it (ADMIN_EMAILS).
 */

import { accessError, checkState, signIn, type OAuthEnv } from '../_lib/oauth.ts'

interface Env extends OAuthEnv {
  GOOGLE_CLIENT_ID:     string
  GOOGLE_CLIENT_SECRET: string
}

interface GoogleTokenResponse {
  access_token: string
  id_token:     string
}

interface GoogleUserInfo {
  sub:            string
  email:          string
  email_verified: boolean
  name:           string
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url)
  if (url.searchParams.get('error')) return accessError('denied')   // the user declined at Google

  const state = checkState(request, 'google')
  if (!state.ok) return accessError('state')

  const code = url.searchParams.get('code')
  if (!code) return accessError('failed')

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri:  `${url.origin}/auth/callback`,
      grant_type:    'authorization_code',
    }),
  })
  if (!tokenRes.ok) return accessError('failed')
  const tokens: GoogleTokenResponse = await tokenRes.json()

  const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  if (!userRes.ok) return accessError('failed')
  const googleUser: GoogleUserInfo = await userRes.json()
  if (!googleUser.email_verified) return accessError('unverified')

  return signIn(env, {
    provider:   'google',
    providerId: googleUser.sub,
    email:      googleUser.email,
    name:       googleUser.name,
  }, state.next)
}
