import { describe, expect, it } from 'vitest'
import { OLD_WRITE_FLAGS, oldFlagsIn, productionBanner } from './env.ts'

describe('oldFlagsIn', () => {
  it('finds the switches that predate the convention', () => {
    expect(oldFlagsIn(['node', 'script.ts', '--dry'])).toEqual(['--dry'])
    expect(oldFlagsIn(['--apply', '--production'])).toEqual(['--apply'])
    expect(oldFlagsIn(['--dry-run', '--dry'])).toEqual(['--dry', '--dry-run'])
  })

  it('finds none in a line that follows the convention', () => {
    expect(oldFlagsIn(['node', 'script.ts', '--production', '--write', '--accept-review=x'])).toEqual([])
    expect(oldFlagsIn([])).toEqual([])
  })

  it('does not take a flag that merely starts like an old one', () => {
    expect(oldFlagsIn(['--drying', '--applyall'])).toEqual([])
  })

  it('knows all three', () => {
    expect([...OLD_WRITE_FLAGS].sort()).toEqual(['--apply', '--dry', '--dry-run'])
  })
})

describe('productionBanner', () => {
  it('says WRITING only when the script was given --write', () => {
    expect(productionBanner('db.example.io', true)).toBe('▶ PRODUCTION db.example.io — WRITING')
    expect(productionBanner('db.example.io', false)).toBe('▶ PRODUCTION db.example.io — read only')
  })
})
