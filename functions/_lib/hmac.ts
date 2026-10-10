/**
 * HMAC-SHA256 on a raw request body, the way the bot's calls are signed: header `X-Hub-Signature-256: sha256=<hex>`.
 * Used by ingest and by the sitemap rebuild (#220).
 */

export async function verifyHmac(body: ArrayBuffer, header: string, secret: string): Promise<boolean> {
  const expected = header.replace(/^sha256=/, '')
  if (!expected) return false

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sigBuf = await crypto.subtle.sign('HMAC', key, body)
  const actual = [...new Uint8Array(sigBuf)].map((b) => b.toString(16).padStart(2, '0')).join('')

  return timingSafeEqual(expected, actual)
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
