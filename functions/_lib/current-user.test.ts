import { describe, expect, it } from 'vitest'
import { resolveUser } from './current-user.ts'
import { createSessionCookie, type SessionUser } from './session.ts'
import { signJwt } from './jwt.ts'

const SECRET = 'secret'
const cookieUser: SessionUser = { id: 'github:1', email: 'old@example.org', name: 'Old Name', role: 'pending' }

/** A D1 stand-in that answers `SELECT … FROM users WHERE id = ?` from a map. */
function fakeD1(rows: Record<string, { email: string; name: string | null; role: string }>) {
  return {
    prepare: () => ({
      bind: (id: string) => ({ first: () => Promise.resolve(rows[id] ?? null) }),
    }),
  } as unknown as D1Database
}

async function withCookie(user: SessionUser) {
  const cookie = (await createSessionCookie(user, SECRET)).split(';')[0]
  return new Request('https://example.org/', { headers: { Cookie: cookie } })
}

describe('resolveUser', () => {
  it('takes the role from D1, not from the cookie', async () => {
    const env = { SESSION_SECRET: SECRET, milorg_users: fakeD1({ 'github:1': { email: 'new@example.org', name: 'New Name', role: 'admin' } }) }
    const user = await resolveUser(await withCookie(cookieUser), env)
    expect(user).toEqual({ id: 'github:1', email: 'new@example.org', name: 'New Name', role: 'admin' })
  })

  it('applies a demotion to a cookie minted as admin', async () => {
    const env = { SESSION_SECRET: SECRET, milorg_users: fakeD1({ 'github:1': { email: 'a@example.org', name: 'A', role: 'denied' } }) }
    const user = await resolveUser(await withCookie({ ...cookieUser, role: 'admin' }), env)
    expect(user?.role).toBe('denied')
  })

  it('treats an account that no longer exists as signed out', async () => {
    const env = { SESSION_SECRET: SECRET, milorg_users: fakeD1({}) }
    expect(await resolveUser(await withCookie(cookieUser), env)).toBeNull()
  })

  it('falls back to the name in the cookie when the row has none', async () => {
    const env = { SESSION_SECRET: SECRET, milorg_users: fakeD1({ 'github:1': { email: 'a@example.org', name: null, role: 'editor' } }) }
    expect((await resolveUser(await withCookie(cookieUser), env))?.name).toBe('Old Name')
  })

  it('uses the cookie as is when there is no D1 binding', async () => {
    const user = await resolveUser(await withCookie(cookieUser), { SESSION_SECRET: SECRET })
    expect(user).toEqual(cookieUser)
  })

  it('trusts a signed bearer token without asking D1', async () => {
    const { token } = await signJwt({ sub: 'direct:gjest', email: 'g@example.org', name: 'Gjest', role: 'admin' }, SECRET, 60)
    const req = new Request('https://example.org/', { headers: { Authorization: `Bearer ${token}` } })
    const env = { SESSION_SECRET: SECRET, milorg_users: fakeD1({}) }
    expect(await resolveUser(req, env)).toMatchObject({ id: 'direct:gjest', role: 'admin' })
  })

  it('returns null without credentials, and for a cookie signed with another secret', async () => {
    const env = { SESSION_SECRET: SECRET }
    expect(await resolveUser(new Request('https://example.org/'), env)).toBeNull()
    const other = await createSessionCookie(cookieUser, 'other')
    const req = new Request('https://example.org/', { headers: { Cookie: other.split(';')[0] } })
    expect(await resolveUser(req, env)).toBeNull()
  })
})
