import { describe, expect, it } from 'vitest'
import { clearSessionCookie, createSessionCookie, readSession, type SessionUser } from './session.ts'

const user: SessionUser = { id: 'github:1', email: 'a@example.org', name: 'Åse 🌲 Berg', role: 'editor' }

/** The Set-Cookie header a browser would send back as Cookie. */
const asRequest = (setCookie: string) =>
  new Request('https://example.org/', { headers: { Cookie: setCookie.split(';')[0] } })

describe('session cookie', () => {
  it('round-trips a user, including non-Latin-1 names', async () => {
    const cookie = await createSessionCookie(user, 'secret')
    expect(await readSession(asRequest(cookie), 'secret')).toEqual(user)
  })

  it('is HttpOnly, Secure and SameSite=Lax', async () => {
    const cookie = await createSessionCookie(user, 'secret')
    expect(cookie).toMatch(/HttpOnly/)
    expect(cookie).toMatch(/Secure/)
    expect(cookie).toMatch(/SameSite=Lax/)
  })

  it('rejects a cookie signed with another secret', async () => {
    const cookie = await createSessionCookie(user, 'secret')
    expect(await readSession(asRequest(cookie), 'other')).toBeNull()
  })

  it('rejects a tampered payload', async () => {
    const cookie = await createSessionCookie(user, 'secret')
    const [name, value] = cookie.split(';')[0].split('=')
    const [, sig] = value.split('.')
    const forged = btoa(JSON.stringify({ ...user, name: 'Ase', role: 'admin' }))
    const req = new Request('https://example.org/', { headers: { Cookie: `${name}=${forged}.${sig}` } })
    expect(await readSession(req, 'secret')).toBeNull()
  })

  it('returns null without a session cookie', async () => {
    expect(await readSession(new Request('https://example.org/'), 'secret')).toBeNull()
    const other = new Request('https://example.org/', { headers: { Cookie: 'theme=dark' } })
    expect(await readSession(other, 'secret')).toBeNull()
  })

  it('still reads older Latin-1 payloads', async () => {
    const legacy: SessionUser = { ...user, name: 'Åse Berg' }
    const cookie = await createSessionCookie(legacy, 'secret')
    // Rebuild the pre-UTF-8 envelope: plain btoa of the JSON, same HMAC scheme.
    const payload = btoa(JSON.stringify(legacy))
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)))))
    const name = cookie.split('=')[0]
    const req = new Request('https://example.org/', { headers: { Cookie: `${name}=${payload}.${sig}` } })
    expect(await readSession(req, 'secret')).toEqual(legacy)
  })

  it('clears the cookie with Max-Age=0', () => {
    expect(clearSessionCookie()).toMatch(/Max-Age=0/)
  })
})
