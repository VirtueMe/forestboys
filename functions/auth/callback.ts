/**
 * GET /auth/callback — exchange Google code, upsert user in D1, set session cookie
 */

import { createSessionCookie } from '../_lib/session.ts'

interface Env {
  GOOGLE_CLIENT_ID:     string
  GOOGLE_CLIENT_SECRET: string
  SESSION_SECRET:       string
  ADMIN_EMAILS:         string
  milorg_users:         D1Database
}

interface GoogleTokenResponse {
  access_token: string
  id_token:     string
}

interface GoogleUserInfo {
  sub:   string
  email: string
  name:  string
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')

  if (!code) {
    return new Response('Missing code', { status: 400 })
  }

  // Exchange code for tokens
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

  if (!tokenRes.ok) {
    return new Response('Token exchange failed', { status: 502 })
  }

  const tokens: GoogleTokenResponse = await tokenRes.json()

  // Get user info
  const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })

  if (!userRes.ok) {
    return new Response('Failed to fetch user info', { status: 502 })
  }

  const googleUser: GoogleUserInfo = await userRes.json()

  // Determine role — admin bootstrap via ADMIN_EMAILS env var
  const adminEmails = (env.ADMIN_EMAILS ?? '').split(',').map(e => e.trim().toLowerCase())
  const isAdmin = adminEmails.includes(googleUser.email.toLowerCase())

  // Upsert user in D1
  const existing = await env.milorg_users
    .prepare('SELECT role FROM users WHERE id = ?')
    .bind(googleUser.sub)
    .first<{ role: string }>()

  let role: string
  if (existing) {
    role = existing.role
    await env.milorg_users
      .prepare('UPDATE users SET last_login = datetime(\'now\'), name = ? WHERE id = ?')
      .bind(googleUser.name, googleUser.sub)
      .run()
  } else {
    role = isAdmin ? 'admin' : 'pending'
    await env.milorg_users
      .prepare('INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, ?)')
      .bind(googleUser.sub, googleUser.email, googleUser.name, role)
      .run()
  }

  // Set session cookie and redirect
  const cookie = await createSessionCookie(
    { id: googleUser.sub, email: googleUser.email, name: googleUser.name, role },
    env.SESSION_SECRET,
  )

  return new Response(null, {
    status: 302,
    headers: {
      Location:   '/',
      'Set-Cookie': cookie,
    },
  })
}
