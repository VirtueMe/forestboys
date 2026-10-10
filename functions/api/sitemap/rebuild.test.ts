import { describe, expect, it } from 'vitest'
import { onRequestPost } from './rebuild.ts'

const SECRET = 's3cret'
async function sign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return 'sha256=' + [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('')
}
const call = (headers: Record<string, string>, env: object = { BOT_INGEST_SECRET: SECRET }) =>
  (onRequestPost as unknown as (c: unknown) => Promise<Response>)({
    request: new Request('https://x.test/api/sitemap/rebuild', { method: 'POST', body: '', headers }), env,
  })

describe('POST /api/sitemap/rebuild', () => {
  it('refuses a missing or wrong signature', async () => {
    expect((await call({})).status).toBe(401)
    expect((await call({ 'X-Hub-Signature-256': 'sha256=' + '0'.repeat(64) })).status).toBe(401)
  })
  it('is 500 when the secret is not configured', async () => {
    expect((await call({ 'X-Hub-Signature-256': await sign('') }, {})).status).toBe(500)
  })
  it('a valid signature gets as far as the rebuild, which reports what is missing', async () => {
    const res = await call({ 'X-Hub-Signature-256': await sign('') })
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'SITEMAP KV binding missing' })
  })
})
