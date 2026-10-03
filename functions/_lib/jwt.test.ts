import { afterEach, describe, expect, it, vi } from 'vitest'
import { signJwt, verifyJwt } from './jwt.ts'

const claims = { sub: 'github:1', email: 'a@example.org', name: 'Åse', role: 'editor' }

afterEach(() => vi.useRealTimers())

describe('JWT', () => {
  it('round-trips claims', async () => {
    const { token, exp } = await signJwt(claims, 'secret', 60)
    const out = await verifyJwt(token, 'secret')
    expect(out).toMatchObject(claims)
    expect(out?.exp).toBe(exp)
  })

  it('rejects a token signed with another secret', async () => {
    const { token } = await signJwt(claims, 'secret', 60)
    expect(await verifyJwt(token, 'other')).toBeNull()
  })

  it('rejects a tampered payload', async () => {
    const { token } = await signJwt(claims, 'secret', 60)
    const [h, , s] = token.split('.')
    const forged = btoa(JSON.stringify({ ...claims, role: 'admin', exp: 9999999999, iat: 0 }))
      .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
    expect(await verifyJwt(`${h}.${forged}.${s}`, 'secret')).toBeNull()
  })

  it('rejects an expired token', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const { token } = await signJwt(claims, 'secret', 60)
    vi.setSystemTime(new Date('2026-01-01T00:01:01Z'))
    expect(await verifyJwt(token, 'secret')).toBeNull()
  })

  it('rejects malformed tokens', async () => {
    expect(await verifyJwt('', 'secret')).toBeNull()
    expect(await verifyJwt('a.b', 'secret')).toBeNull()
    expect(await verifyJwt('a.b.c.d', 'secret')).toBeNull()
  })
})
