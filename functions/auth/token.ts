/**
 * Username/password → JWT bearer token.
 *
 * Provisional auth path pre-Google: lets Jan and Rolf log in with credentials
 * we issue manually, without committing to Google OAuth. The returned token
 * is a JWT signed by SESSION_SECRET; /auth/me accepts it via
 * `Authorization: Bearer <token>`.
 *
 * GET  /auth/token                          → { enabled: boolean }
 * POST /auth/token  { username, password }  → { access_token, token_type, expires_in, user }
 *
 * Env vars (all set on the Pages env where direct login is allowed):
 *   DIRECT_LOGIN_USERNAME       — plaintext username
 *   DIRECT_LOGIN_PASSWORD_HASH  — PBKDF2 hash in format `pbkdf2$<iter>$<salt-b64>$<hash-b64>`.
 *                                 Generate with `npx tsx scripts/hash-password.ts`.
 *   DIRECT_LOGIN_USER_NAME      — display name (default 'Gjestebruker')
 *   DIRECT_LOGIN_USER_EMAIL     — identifier email (default 'gjest@milorg.local')
 *   DIRECT_LOGIN_ROLE           — 'admin' | 'editor' | 'pending' (default 'admin')
 *   SESSION_SECRET              — JWT signing key (shared with the cookie session path)
 *
 * Turn feature off: unset either DIRECT_LOGIN_USERNAME or DIRECT_LOGIN_PASSWORD_HASH.
 */

import { signJwt } from '../_lib/jwt.ts'

interface Env {
  SESSION_SECRET:              string
  DIRECT_LOGIN_USERNAME?:      string
  DIRECT_LOGIN_PASSWORD_HASH?: string
  DIRECT_LOGIN_USER_NAME?:     string
  DIRECT_LOGIN_USER_EMAIL?:    string
  DIRECT_LOGIN_ROLE?:          string
}

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30   // 30 days

function isEnabled(env: Env): boolean {
  return Boolean(env.DIRECT_LOGIN_USERNAME && env.DIRECT_LOGIN_PASSWORD_HASH)
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  })
}

// Constant-time string comparison — rejects short-circuit timing attacks.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

// ── PBKDF2 verify ──────────────────────────────────────────────────────
// Hash format stored in env: `pbkdf2$<iterations>$<salt-b64>$<hash-b64>`
async function verifyPassword(password: string, hashSpec: string): Promise<boolean> {
  const parts = hashSpec.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false
  const iterations = Number(parts[1])
  if (!Number.isFinite(iterations) || iterations < 1) return false

  const salt = base64ToBytes(parts[2])
  const want = base64ToBytes(parts[3])

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    want.length * 8,
  )
  const got = new Uint8Array(bits)
  if (got.length !== want.length) return false
  let mismatch = 0
  for (let i = 0; i < got.length; i++) mismatch |= got[i] ^ want[i]
  return mismatch === 0
}

function base64ToBytes(b64: string): Uint8Array {
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

// ── Routes ─────────────────────────────────────────────────────────────
export const onRequestGet: PagesFunction<Env> = ({ env }) => {
  return json({ enabled: isEnabled(env) })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!isEnabled(env)) return new Response('Not found', { status: 404 })

  let body: { username?: string; password?: string }
  try { body = await request.json() }
  catch { return json({ error: 'Invalid JSON' }, 400) }

  if (!body.username || !body.password ||
      typeof body.username !== 'string' || typeof body.password !== 'string') {
    return json({ error: 'Missing username or password' }, 400)
  }

  const usernameOk = safeEqual(body.username, env.DIRECT_LOGIN_USERNAME ?? '')
  const passwordOk = await verifyPassword(body.password, env.DIRECT_LOGIN_PASSWORD_HASH ?? '')

  // Do not short-circuit on username mismatch — combine both checks so the
  // response time doesn't leak whether the username exists.
  if (!(usernameOk && passwordOk)) {
    return json({ error: 'Feil brukernavn eller passord.' }, 401)
  }

  const user = {
    id:    'direct-login',
    email: env.DIRECT_LOGIN_USER_EMAIL ?? 'gjest@milorg.local',
    name:  env.DIRECT_LOGIN_USER_NAME  ?? 'Gjestebruker',
    role:  env.DIRECT_LOGIN_ROLE       ?? 'admin',
  }

  const { token, exp } = await signJwt(
    { sub: user.id, email: user.email, name: user.name, role: user.role },
    env.SESSION_SECRET,
    TOKEN_TTL_SECONDS,
  )

  return json({
    access_token: token,
    token_type:   'Bearer',
    expires_in:   TOKEN_TTL_SECONDS,
    expires_at:   exp,
    user,
  })
}
