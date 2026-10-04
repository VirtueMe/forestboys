import { describe, expect, it } from 'vitest'
import { groupByRole } from './roleGroups.ts'

const e = (id: string, role?: string | null) => ({ id, role })

describe('groupByRole', () => {
  it('is empty for no entries', () => {
    expect(groupByRole([])).toEqual([])
  })

  it('puts instructors, then training, then stationed first', () => {
    const groups = groupByRole([e('a', 'stationed'), e('b', 'training'), e('c', 'instructor')])
    expect(groups.map(g => g.role)).toEqual(['instructor', 'training', 'stationed'])
  })

  it('puts the other roles after those, by display name, and no role last', () => {
    const names: Record<string, string> = { imprisoned: 'fange', hiding: 'i skjul' }
    const groups = groupByRole(
      [e('a', null), e('b', 'imprisoned'), e('c', 'stationed'), e('d', 'hiding'), e('e', undefined)],
      k => names[k] ?? k,
    )
    expect(groups.map(g => g.role)).toEqual(['stationed', 'imprisoned', 'hiding', null])
  })

  it('treats an empty role as no role', () => {
    expect(groupByRole([e('a', ''), e('b', null)])).toEqual([{ role: null, entries: [e('a', ''), e('b', null)] }])
  })

  it('keeps the entries of a group in their order and does not change the input', () => {
    const input = [e('1', 'training'), e('2', 'instructor'), e('3', 'training')]
    const groups = groupByRole(input)
    expect(groups.find(g => g.role === 'training')?.entries.map(x => x.id)).toEqual(['1', '3'])
    expect(input.map(x => x.id)).toEqual(['1', '2', '3'])
  })
})
