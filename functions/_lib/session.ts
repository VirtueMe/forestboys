/**
 * Signed session cookie helpers.
 * Uses HMAC-SHA256 to sign a JSON payload — no external dependencies.
 */

const COOKIE_NAME = 'milorg_session'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30  // 30 days

export interface SessionUser {
  id:    string
  email: string
  name:  string
  role:  string
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
}

export async function createSessionCookie(user: SessionUser, secret: string): Promise<string> {
  const payload = btoa(JSON.stringify(user))
  const sig = await hmac(secret, payload)
  const value = `${payload}.${sig}`
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`
}

export async function readSession(request: Request, secret: string): Promise<SessionUser | null> {
  const cookie = request.headers.get('Cookie') ?? ''
  const match = cookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`))
  if (!match) return null

  const [payload, sig] = match[1].split('.')
  if (!payload || !sig) return null

  const expected = await hmac(secret, payload)
  if (expected !== sig) return null

  try {
    return JSON.parse(atob(payload)) as SessionUser
  } catch {
    return null
  }
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}
