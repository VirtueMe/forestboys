import { describe, expect, it } from 'vitest'
import { parseAttended } from './role-scopes.ts'

describe('parseAttended', () => {
  it('is false when absent', () => {
    expect(parseAttended(undefined, ['membership'])).toEqual({ attended: false })
    expect(parseAttended(null, ['stationed'])).toEqual({ attended: false })
  })

  it('accepts true for a role in the stationed scope', () => {
    expect(parseAttended(true, ['stationed'])).toEqual({ attended: true })
    expect(parseAttended(true, ['membership', 'stationed'])).toEqual({ attended: true })
  })

  it('accepts false anywhere', () => {
    expect(parseAttended(false, ['membership'])).toEqual({ attended: false })
  })

  it('refuses true without the stationed scope', () => {
    expect(parseAttended(true, ['membership'])).toHaveProperty('error')
  })

  it.each(['yes', 1, 'true', {}])('refuses %j', (v) => {
    expect(parseAttended(v, ['stationed'])).toHaveProperty('error')
  })
})
