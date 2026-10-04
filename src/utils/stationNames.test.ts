import { describe, expect, it } from 'vitest'
import { aliasHint, formatNamePeriod, matchingName, sortNames, type NameLike } from './stationNames.ts'

const name = (over: Partial<NameLike> = {}): NameLike =>
  ({ value: 'STS 47', type: 'later', from: null, fromAbout: false, to: null, toAbout: false, ...over })

describe('formatNamePeriod', () => {
  it('is empty without dates', () => {
    expect(formatNamePeriod(name())).toBe('')
  })

  it('shows an open end as a trailing dash', () => {
    expect(formatNamePeriod(name({ from: '1943' }))).toBe('1943 –')
  })

  it('marks approximate dates with ca.', () => {
    expect(formatNamePeriod(name({ from: '1943', fromAbout: true, to: '1945-02', toAbout: true }))).toBe('ca. 1943 – ca. 1945-02')
  })

  it('shows an unknown start as a question mark', () => {
    expect(formatNamePeriod(name({ to: '1943' }))).toBe('? – 1943')
  })
})

describe('sortNames', () => {
  it('puts former names first, then later, then aliases', () => {
    const out = sortNames([name({ value: 'c', type: 'alias' }), name({ value: 'b', type: 'later' }), name({ value: 'a', type: 'former' })])
    expect(out.map(n => n.value)).toEqual(['a', 'b', 'c'])
  })

  it('orders by start date within a type, undated last', () => {
    const out = sortNames([
      name({ value: 'x', type: 'former' }),
      name({ value: 'b', type: 'former', from: '1943-05' }),
      name({ value: 'a', type: 'former', from: '1941' }),
    ])
    expect(out.map(n => n.value)).toEqual(['a', 'b', 'x'])
  })

  it('does not change the input', () => {
    const input = [name({ value: 'b', type: 'alias' }), name({ value: 'a', type: 'former' })]
    sortNames(input)
    expect(input.map(n => n.value)).toEqual(['b', 'a'])
  })
})

describe('matchingName / aliasHint', () => {
  const names = ['STS 47', 'Stodham']

  it('finds an other name containing the query, ignoring case', () => {
    expect(matchingName('sts 4', names)).toBe('STS 47')
    expect(matchingName('xyz', names)).toBeNull()
  })

  it('finds nothing for an empty query or no names', () => {
    expect(matchingName('  ', names)).toBeNull()
    expect(matchingName('sts', undefined)).toBeNull()
  })

  it('hints at the other name only when the title did not match itself', () => {
    expect(aliasHint('sts 47', 'STS 03 Stodham Park', names)).toBe('STS 47')
    expect(aliasHint('stodham', 'STS 03 Stodham Park', names)).toBeNull()
    expect(aliasHint('', 'STS 03 Stodham Park', names)).toBeNull()
  })
})
