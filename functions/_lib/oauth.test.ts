import { describe, expect, it } from 'vitest'
import { signIn, type OAuthEnv } from './oauth.ts'

/** D1 stand-in for signIn: one existing user (by id) or none. */
function fakeD1(existing: { id: string; role: string } | null) {
  const inserted: unknown[][] = []
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: () => Promise.resolve(sql.includes('WHERE id') && existing && args[0] === existing.id ? { role: existing.role } : null),
        run: () => { if (sql.startsWith('INSERT')) inserted.push(args); return Promise.resolve({}) },
      }),
    }),
  } as unknown as D1Database
  return { db, inserted }
}

const who = { provider: 'github' as const, providerId: '1', email: 'a@example.org', name: 'A' }
const env = (db: D1Database, admins = ''): OAuthEnv => ({ SESSION_SECRET: 'secret', ADMIN_EMAILS: admins, milorg_users: db })

describe('signIn redirect', () => {
  it('sends a new (pending) user to /access, not to where they were going', async () => {
    const { db, inserted } = fakeD1(null)
    const res = await signIn(env(db), who, '/admin/proposals')
    expect(res.headers.get('Location')).toBe('/access')
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toContain('pending')
  })

  it('sends a denied user to /access', async () => {
    const { db } = fakeD1({ id: 'github:1', role: 'denied' })
    expect((await signIn(env(db), who, '/x')).headers.get('Location')).toBe('/access')
  })

  it('sends an editor to where they were going', async () => {
    const { db } = fakeD1({ id: 'github:1', role: 'editor' })
    expect((await signIn(env(db), who, '/admin/proposals')).headers.get('Location')).toBe('/admin/proposals')
  })

  it('makes a new user listed in ADMIN_EMAILS an admin and lets them through', async () => {
    const { db, inserted } = fakeD1(null)
    const res = await signIn(env(db, 'x@example.org, A@Example.org'), who, '/admin')
    expect(inserted[0]).toContain('admin')
    expect(res.headers.get('Location')).toBe('/admin')
  })

  it('does not follow an external next', async () => {
    const { db } = fakeD1({ id: 'github:1', role: 'admin' })
    expect((await signIn(env(db), who, '//evil.example')).headers.get('Location')).toBe('/')
  })
})
