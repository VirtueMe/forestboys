import { describe, expect, it } from 'vitest'
import { DEFAULT_ENTITY_FILTER, filterEntities, type EntityFilter } from './entityFilter.ts'

const entities = [
  ...Array.from({ length: 100 }, (_, i) => ({ entityId: `Person:p${i}`, status: i < 3 ? 'pending' : 'accepted' })),
  ...Array.from({ length: 187 }, (_, i) => ({ entityId: `Unit:u${i}`, status: i === 0 ? 'denied' : i === 1 ? 'drifted' : 'accepted' })),
]
const page = (f: Partial<EntityFilter>) => filterEntities(entities, { ...DEFAULT_ENTITY_FILTER, ...f })

describe('filterEntities on a bundle of 287 entities', () => {
  it('opens on what still waits, so the next thing to decide is the first thing seen', () => {
    const p = page({})
    expect(p.status).toBe('pending')
    expect(p.total).toBe(3)
    expect(p.rows.map(r => r.entityId)).toEqual(['Person:p0', 'Person:p1', 'Person:p2'])
  })

  it('opens on everything when nothing waits any more', () => {
    const done = entities.map(e => ({ ...e, status: 'accepted' }))
    const p = filterEntities(done, DEFAULT_ENTITY_FILTER)
    expect(p.status).toBe('all')
    expect(p.total).toBe(287)
    expect(p.rows).toHaveLength(20)
  })

  it('filters on status, kind and text, and says how many there are of each status', () => {
    expect(page({ status: 'denied' }).rows.map(r => r.entityId)).toEqual(['Unit:u0'])
    expect(page({ status: 'all', kind: 'Unit' }).total).toBe(187)
    expect(page({ status: 'all', q: 'P9' }).total).toBe(11)                  // p9 and p90–p99
    expect(page({ status: 'all', kind: 'Person', q: 'u1' }).total).toBe(0)
    expect(page({}).counts).toEqual({ pending: 3, accepted: 282, denied: 1, drifted: 1, all: 287 })
    expect(page({}).kinds).toEqual(['Person', 'Unit'])
  })

  it('pages 10, 20 or 40 at a time, with the total before paging', () => {
    const all = (limit: number, offset: number) => page({ status: 'all', limit, offset })
    expect(all(10, 0).rows).toHaveLength(10)
    expect(all(40, 280).rows).toHaveLength(7)
    expect(all(40, 280).total).toBe(287)
    expect(all(20, 300).rows).toHaveLength(0)
    expect(all(10, 10).rows[0].entityId).toBe('Person:p10')
  })
})
