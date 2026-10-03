/**
 * Shared by the OAuth sign-ins (Google, GitHub): CSRF state and the
 * user upsert that ends in a session cookie.
 *
 * State — a random value in a short-lived cookie, sent to the provider and
 * checked on the callback, so a callback the user didn't start is refused.
 * The cookie also carries where to go after sign-in (`next`, a local path).
 *
 * Users (D1 `users`, migrations/0002) — one row per person:
 *   id        `<provider>:<provider's user id>` (`google:<sub>`, `github:<id>`)
 *   provider  'google' | 'github'
 *   email     the provider's verified email, lowercased — UNIQUE
 * One account per email, no linking: a sign-in whose email belongs to the
 * other provider is refused and sent back to /access with that provider
 * named. New users are `pending`; ADMIN_EMAILS bootstraps admins.
 */

import { createSessionCookie } from './session.ts'

export type Provider = 'google' | 'github'

export const PROVIDER_LABEL: Record<Provider, string> = { google: 'Google', github: 'GitHub' }

const STATE_COOKIE = 'milorg_oauth_state'
const STATE_MAX_AGE = 600   // 10 minutes to finish at the provider

export interface OAuthEnv {
  SESSION_SECRET: string
  ADMIN_EMAILS?:  string
  milorg_users:   D1Database
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A local path to return to after sign-in, or '/'. */
export function safeNext(raw: string | null | undefined): string {
  return raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/'
}

/** Start a sign-in: the state value for the provider and the cookie that remembers it. */
export function newState(provider: Provider, next: string): { state: string; cookie: string } {
  const state = randomToken()
  const value = encodeURIComponent(JSON.stringify({ provider, state, next: safeNext(next) }))
  return {
    state,
    cookie: `${STATE_COOKIE}=${value}; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=${STATE_MAX_AGE}`,
  }
}

export function clearStateCookie(): string {
  return `${STATE_COOKIE}=; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}

/** The callback's state must match the cookie set when this provider's sign-in started. */
export function checkState(request: Request, provider: Provider): { ok: true; next: string } | { ok: false } {
  const got = new URL(request.url).searchParams.get('state')
  const raw = (request.headers.get('Cookie') ?? '').match(new RegExp(`${STATE_COOKIE}=([^;]+)`))?.[1]
  if (!got || !raw) return { ok: false }
  try {
    const saved = JSON.parse(decodeURIComponent(raw)) as { provider?: string; state?: string; next?: string }
    if (saved.provider !== provider || saved.state !== got) return { ok: false }
    return { ok: true, next: safeNext(saved.next) }
  } catch {
    return { ok: false }
  }
}

/** Redirect to /access with an error code the page explains. */
export function accessError(code: string, extra: Record<string, string> = {}): Response {
  const params = new URLSearchParams({ error: code, ...extra })
  return new Response(null, {
    status: 302,
    headers: [['Location', `/access?${params.toString()}`], ['Set-Cookie', clearStateCookie()]],
  })
}

/**
 * Find or create the user, refuse an email that belongs to the other
 * provider, and answer with the session cookie and a redirect to `next`.
 */
export async function signIn(
  env:  OAuthEnv,
  who:  { provider: Provider; providerId: string; email: string; name: string },
  next: string,
): Promise<Response> {
  const id    = `${who.provider}:${who.providerId}`
  const email = who.email.trim().toLowerCase()
  const db    = env.milorg_users

  const byId = await db.prepare('SELECT role FROM users WHERE id = ?').bind(id).first<{ role: string }>()
  let role: string
  if (byId) {
    role = byId.role
    await db.prepare(`UPDATE users SET last_login = datetime('now'), name = ?, email = ? WHERE id = ?`)
      .bind(who.name, email, id).run()
  } else {
    const byEmail = await db.prepare('SELECT provider FROM users WHERE email = ?').bind(email).first<{ provider: string | null }>()
    if (byEmail) {
      const other = (byEmail.provider ?? 'google') as Provider
      return accessError('provider', { provider: other in PROVIDER_LABEL ? other : 'google' })
    }
    const admins = (env.ADMIN_EMAILS ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
    role = admins.includes(email) ? 'admin' : 'pending'
    await db.prepare('INSERT INTO users (id, provider, email, name, role) VALUES (?, ?, ?, ?, ?)')
      .bind(id, who.provider, email, who.name, role).run()
  }

  const session = await createSessionCookie({ id, email, name: who.name, role }, env.SESSION_SECRET)
  return new Response(null, {
    status: 302,
    // Only editors and admins have anything to do at `next`; a pending or
    // denied user is sent to see where their request stands.
    headers: [['Location', role === 'admin' || role === 'editor' ? safeNext(next) : '/access'], ['Set-Cookie', session], ['Set-Cookie', clearStateCookie()]],
  })
}
