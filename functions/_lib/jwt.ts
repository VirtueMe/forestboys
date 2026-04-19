/**
 * HS256 JWT sign + verify using Web Crypto.
 *
 * Shares SESSION_SECRET with the cookie session path — same signing key,
 * different envelope. Tokens issued here are verified by /auth/me and
 * anywhere else that needs to authenticate an API request.
 */

export interface JwtClaims {
  sub:   string
  email: string
  name:  string
  role:  string
  exp:   number     // Unix seconds
  iat:   number
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// ── base64url (no padding) ─────────────────────────────────────────────
function b64urlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (const b of buf) s += String.fromCharCode(b)
  return btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function b64urlDecode(str: string): Uint8Array {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4))
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

// ── HMAC key cache ─────────────────────────────────────────────────────
const keyCache = new Map<string, Promise<CryptoKey>>()
function getKey(secret: string): Promise<CryptoKey> {
  const cached = keyCache.get(secret)
  if (cached) return cached
  const promise = crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
  keyCache.set(secret, promise)
  return promise
}

// ── Sign ───────────────────────────────────────────────────────────────
export async function signJwt(
  claims: Omit<JwtClaims, 'iat' | 'exp'>,
  secret: string,
  ttlSeconds: number,
): Promise<{ token: string; exp: number }> {
  const header = { alg: 'HS256', typ: 'JWT' }
  const iat    = Math.floor(Date.now() / 1000)
  const exp    = iat + ttlSeconds
  const fullClaims: JwtClaims = { ...claims, iat, exp }

  const encodedHeader  = b64urlEncode(encoder.encode(JSON.stringify(header)))
  const encodedPayload = b64urlEncode(encoder.encode(JSON.stringify(fullClaims)))
  const signingInput   = `${encodedHeader}.${encodedPayload}`

  const key = await getKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput))
  return { token: `${signingInput}.${b64urlEncode(sig)}`, exp }
}

// ── Verify ─────────────────────────────────────────────────────────────
export async function verifyJwt(
  token: string,
  secret: string,
): Promise<JwtClaims | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [encodedHeader, encodedPayload, encodedSig] = parts

  const key = await getKey(secret)
  const ok  = await crypto.subtle.verify(
    'HMAC',
    key,
    b64urlDecode(encodedSig),
    encoder.encode(`${encodedHeader}.${encodedPayload}`),
  )
  if (!ok) return null

  let claims: JwtClaims
  try {
    claims = JSON.parse(decoder.decode(b64urlDecode(encodedPayload))) as JwtClaims
  } catch { return null }

  if (typeof claims.exp !== 'number' || claims.exp <= Math.floor(Date.now() / 1000)) {
    return null   // expired
  }
  return claims
}
