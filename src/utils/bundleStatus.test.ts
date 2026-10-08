import { describe, expect, it } from 'vitest'
import { bundleCounts, bundleStatus, bundleStatusLabel } from './bundleStatus.ts'

const ents = (...s: string[]) => s.map(status => ({ status }))

describe('bundleStatus', () => {
  it('is pending while any entity waits', () => {
    expect(bundleStatus({ entities: ents('pending') })).toBe('pending')
    expect(bundleStatus({ entities: ents('accepted', 'pending', 'denied') })).toBe('pending')
  })

  it('is closed when the last pending entity is accepted', () => {
    expect(bundleStatus({ entities: ents('accepted', 'accepted') })).toBe('closed')
  })

  it('is closed when the last pending entity is denied', () => {
    expect(bundleStatus({ entities: ents('accepted', 'denied') })).toBe('closed')
  })

  it('counts an entity that was set aside as decided, not as waiting', () => {
    expect(bundleStatus({ entities: ents('drifted') })).toBe('closed')
    expect(bundleStatus({ entities: ents('drifted', 'pending') })).toBe('pending')
  })

  it('keeps blocked while something waits, and closes it once nothing does', () => {
    expect(bundleStatus({ status: 'blocked', entities: ents('pending', 'accepted') })).toBe('blocked')
    expect(bundleStatus({ status: 'blocked', entities: ents('denied') })).toBe('closed')
  })

  it('ignores a stored closed or pending that the entities contradict', () => {
    expect(bundleStatus({ status: 'closed', entities: ents('pending') })).toBe('pending')
    expect(bundleStatus({ status: 'pending', entities: ents('accepted') })).toBe('closed')
  })

  it('is closed for a bundle with no entities', () => {
    expect(bundleStatus({ entities: [] })).toBe('closed')
  })
})

describe('bundleCounts', () => {
  it('counts each status', () => {
    expect(bundleCounts(ents('pending', 'accepted', 'accepted', 'denied', 'drifted')))
      .toEqual({ pending: 1, accepted: 2, denied: 1, drifted: 1 })
  })
})

describe('bundleStatusLabel', () => {
  it('speaks Norwegian', () => {
    expect(bundleStatusLabel('pending')).toBe('Venter')
    expect(bundleStatusLabel('closed')).toBe('Lukket')
  })
})
