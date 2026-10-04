import { describe, expect, it } from 'vitest'
import { sortAttended, splitByAttended } from './attended.ts'

const link = (targetName: string, role: string | null = null, startDate: string | null = null) =>
  ({ targetName, role, startDate })

describe('splitByAttended', () => {
  const attendedKeys = new Set(['training', 'instructor'])
  const is = (r: string) => attendedKeys.has(r)

  it('puts links with an attended role under attended, the rest under stationed', () => {
    const out = splitByAttended(
      [link('a', 'training'), link('b', 'stationed'), link('c', 'instructor'), link('d', 'hiding')],
      is,
    )
    expect(out.attended.map(l => l.targetName)).toEqual(['a', 'c'])
    expect(out.stationed.map(l => l.targetName)).toEqual(['b', 'd'])
  })

  it('counts a link without a role as stationed', () => {
    const out = splitByAttended([link('a', null), link('b', undefined as unknown as null)], is)
    expect(out.attended).toEqual([])
    expect(out.stationed).toHaveLength(2)
  })

  it('treats every link as stationed when no role is flagged', () => {
    expect(splitByAttended([link('a', 'training')], () => false).attended).toEqual([])
  })
})

describe('sortAttended', () => {
  it('orders dated rows by start date, oldest first, partial dates by what they share', () => {
    const out = sortAttended([link('c', null, '1943-05'), link('a', null, '1941'), link('b', null, '1941-09')])
    expect(out.map(l => l.targetName)).toEqual(['a', 'b', 'c'])
  })

  it('puts undated rows last, by name', () => {
    const out = sortAttended([link('z'), link('b', null, '1942'), link('Å'), link('a')])
    expect(out.map(l => l.targetName)).toEqual(['b', 'a', 'z', 'Å'])
  })

  it('does not change the input', () => {
    const input = [link('b'), link('a')]
    sortAttended(input)
    expect(input.map(l => l.targetName)).toEqual(['b', 'a'])
  })
})
