import { describe, expect, it } from 'vitest'
import {
  EDITOR_MAX_AGE_MS, VISITOR_MAX_AGE_MS, cacheState, isAdminWrite, maxAgeFor,
} from './cacheFreshness'

const NOW = 1_000_000_000

describe('maxAgeFor', () => {
  it('gives editors and admins a short window and everyone else the long one', () => {
    expect(maxAgeFor('editor')).toBe(EDITOR_MAX_AGE_MS)
    expect(maxAgeFor('admin')).toBe(EDITOR_MAX_AGE_MS)
    for (const r of ['pending', 'denied', null, undefined]) expect(maxAgeFor(r)).toBe(VISITOR_MAX_AGE_MS)
  })
})

describe('cacheState', () => {
  it('is fresh inside the window', () => {
    expect(cacheState(NOW - 10_000, NOW, 'editor', 0)).toBe('fresh')
    expect(cacheState(NOW - 4 * 60_000, NOW, null, 0)).toBe('fresh')
  })

  it('revalidates past the window, sooner for editors', () => {
    expect(cacheState(NOW - 60_000, NOW, 'editor', 0)).toBe('revalidate')
    expect(cacheState(NOW - 60_000, NOW, null, 0)).toBe('fresh')
    expect(cacheState(NOW - 6 * 60_000, NOW, null, 0)).toBe('revalidate')
  })

  it('blocks a cache written before the last admin write, whatever its age', () => {
    expect(cacheState(NOW - 5_000, NOW, 'editor', NOW - 1_000)).toBe('blocked')
    expect(cacheState(NOW - 5_000, NOW, null, NOW - 1_000)).toBe('blocked')
  })

  it('trusts a cache written after the last admin write', () => {
    expect(cacheState(NOW - 500, NOW, 'editor', NOW - 1_000)).toBe('fresh')
  })
})

describe('isAdminWrite', () => {
  it('is true for non-GET requests to /api/admin/', () => {
    expect(isAdminWrite('/api/admin/person/x', 'POST')).toBe(true)
    expect(isAdminWrite('/api/admin/sources/s1', 'delete')).toBe(true)
    expect(isAdminWrite(new URL('https://example.org/api/admin/roles'), 'PUT')).toBe(true)
    expect(isAdminWrite(new Request('https://example.org/api/admin/roles', { method: 'POST' }), 'POST')).toBe(true)
  })

  it('is false for reads and for other paths', () => {
    expect(isAdminWrite('/api/admin/person/x', undefined)).toBe(false)
    expect(isAdminWrite('/api/admin/person/x', 'GET')).toBe(false)
    expect(isAdminWrite('/api/neo4j/query', 'POST')).toBe(false)
    expect(isAdminWrite('/auth/logout', 'POST')).toBe(false)
  })
})
