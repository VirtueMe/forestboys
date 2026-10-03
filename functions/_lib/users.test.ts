import { describe, expect, it } from 'vitest'
import { checkRoleChange, isRole, setUserRole } from './users.ts'

describe('checkRoleChange', () => {
  it('allows approving and denying a request', () => {
    expect(checkRoleChange({ role: 'pending' }, 'editor', 1)).toBeNull()
    expect(checkRoleChange({ role: 'pending' }, 'denied', 1)).toBeNull()
  })

  it('refuses a no-op', () => {
    expect(checkRoleChange({ role: 'editor' }, 'editor', 1)).toMatch(/allerede/)
  })

  it('refuses to remove the last admin, by demotion or denial', () => {
    expect(checkRoleChange({ role: 'admin' }, 'editor', 1)).toMatch(/siste administratoren/)
    expect(checkRoleChange({ role: 'admin' }, 'denied', 1)).toMatch(/siste administratoren/)
    expect(checkRoleChange({ role: 'admin' }, 'pending', 0)).toMatch(/siste administratoren/)
  })

  it('allows demoting an admin when another one remains', () => {
    expect(checkRoleChange({ role: 'admin' }, 'editor', 2)).toBeNull()
  })

  it('allows promoting to admin', () => {
    expect(checkRoleChange({ role: 'editor' }, 'admin', 1)).toBeNull()
  })
})

describe('isRole', () => {
  it('accepts the four roles only', () => {
    for (const r of ['pending', 'editor', 'admin', 'denied']) expect(isRole(r)).toBe(true)
    for (const r of ['root', '', 'Admin', null, undefined, 3]) expect(isRole(r)).toBe(false)
  })
})

/** D1 stand-in: a role per account id, an admin count, and the UPDATEs it received. */
function fakeD1(roles: Record<string, string>) {
  const updates: unknown[][] = []
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: () => Promise.resolve(
          sql.includes('COUNT')
            ? { n: Object.values(roles).filter(r => r === 'admin').length }
            : roles[args[0] as string] ? { role: roles[args[0] as string] } : null,
        ),
        run: () => { updates.push(args); return Promise.resolve({}) },
      }),
      first: () => Promise.resolve({ n: Object.values(roles).filter(r => r === 'admin').length }),
    }),
  } as unknown as D1Database
  return { db, updates }
}

describe('setUserRole', () => {
  it('rejects an unknown role with 400', async () => {
    const { db, updates } = fakeD1({ 'github:1': 'pending' })
    expect(await setUserRole(db, 'github:1', 'root')).toMatchObject({ ok: false, status: 400 })
    expect(updates).toHaveLength(0)
  })

  it('answers 404 for an unknown account', async () => {
    const { db } = fakeD1({})
    expect(await setUserRole(db, 'github:9', 'editor')).toMatchObject({ ok: false, status: 404 })
  })

  it('approves a pending request', async () => {
    const { db, updates } = fakeD1({ 'github:1': 'pending', 'github:2': 'admin' })
    expect(await setUserRole(db, 'github:1', 'editor')).toEqual({ ok: true })
    expect(updates).toEqual([['editor', 'github:1']])
  })

  it('refuses to demote the only admin with 409, and changes nothing', async () => {
    const { db, updates } = fakeD1({ 'github:1': 'admin' })
    expect(await setUserRole(db, 'github:1', 'editor')).toMatchObject({ ok: false, status: 409 })
    expect(updates).toHaveLength(0)
  })
})
