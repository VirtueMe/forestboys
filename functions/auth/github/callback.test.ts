import { afterEach, describe, expect, it, vi } from 'vitest'
import { newState } from '../../_lib/oauth.ts'
import { onRequestGet } from './callback.ts'

// onRequestGet only reads request and env; the rest of the context is unused.
const call = (request: Request, env: Record<string, unknown>) =>
  onRequestGet({ request, env } as unknown as Parameters<typeof onRequestGet>[0]) as Promise<Response>

const env = { GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'wrong', SESSION_SECRET: 's' }

/** A callback request carrying the state cookie a real sign-in start would have set. */
function callback(query: string) {
  const { state, cookie } = newState('github', '/')
  return new Request(`https://example.org/auth/github/callback?state=${state}&${query}`, {
    headers: { Cookie: cookie.split(';')[0] },
  })
}

afterEach(() => vi.restoreAllMocks())

describe('GitHub callback failures', () => {
  it("shows GitHub's own error code when the token exchange is refused", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      Response.json({ error: 'incorrect_client_credentials' }),
    ))
    const res = await call(callback('code=abc'), env)
    expect(res.status).toBe(302)
    const loc = new URL(res.headers.get('Location')!, 'https://example.org')
    expect(loc.pathname).toBe('/access')
    expect(loc.searchParams.get('error')).toBe('failed')
    expect(loc.searchParams.get('detail')).toBe('token:incorrect_client_credentials')
  })

  it('reports an HTTP status when the response has no error code', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 502 })))
    const res = await call(callback('code=abc'), env)
    expect(new URL(res.headers.get('Location')!, 'https://example.org').searchParams.get('detail'))
      .toBe('token:http_502')
  })

  it('turns a thrown error into a failure instead of a server error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')))
    const res = await call(callback('code=abc'), env)
    expect(res.status).toBe(302)
    expect(new URL(res.headers.get('Location')!, 'https://example.org').searchParams.get('detail'))
      .toBe('exception:TypeError')
  })

  it('still reports a bad state as "state", without detail', async () => {
    const req = new Request('https://example.org/auth/github/callback?state=nope&code=abc')
    const res = await call(req, env)
    const loc = new URL(res.headers.get('Location')!, 'https://example.org')
    expect(loc.searchParams.get('error')).toBe('state')
    expect(loc.searchParams.has('detail')).toBe(false)
  })

  it('never puts the secret in the redirect', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'bad_verification_code' })))
    const res = await call(callback('code=abc'), env)
    expect(res.headers.get('Location')).not.toContain('wrong')
  })
})
