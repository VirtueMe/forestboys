import { describe, expect, it } from 'vitest'
import { regularCrewOn } from './eventCrew.ts'
import type { RelationEntry } from './RelationStrategy.ts'

const stint = (targetSlug: string, startDate: string | null, endDate: string | null, role = 'skipper'): RelationEntry =>
  ({ targetSlug, targetName: targetSlug, role, startDate, endDate, sections: [], hasDescription: false })

describe('regularCrewOn', () => {
  it('takes the stints that cover the date, open and partial ends included', () => {
    const regular = [
      stint('before', '1940', '1941'),
      stint('after', '1943-02', null),
      stint('open', null, null),
      stint('same-month', '1942-06', '1942-06'),
    ]
    expect(regularCrewOn(regular, '1942-06-15', []).map(e => e.targetSlug)).toEqual(['open', 'same-month'])
  })

  it('skips what the list has and adds a person and role once, as new rows', () => {
    const regular = [stint('ola', null, null), stint('ola', '1942', null), stint('ola', null, null, 'maskinist'), stint('kari', null, null)]
    const out = regularCrewOn(regular, '1942-06-15', [stint('kari', null, null)])
    expect(out.map(e => [e.targetSlug, e.role, e.edgeId, e.startDate])).toEqual([['ola', 'skipper', null, null], ['ola', 'maskinist', null, null]])
  })
})
