import { describe, expect, it } from 'vitest'
import { PARTIAL_DATE_RE, comparePartial, formatPeriod } from './period'

describe('formatPeriod', () => {
  it('returns an empty string without dates', () => {
    expect(formatPeriod(null, null)).toBe('')
    expect(formatPeriod(undefined, '')).toBe('')
  })

  it('shows an open period with a trailing dash', () => {
    expect(formatPeriod('1943', null)).toBe('1943 –')
  })

  it('shows a closed period', () => {
    expect(formatPeriod('1943-05', '1944-02-10')).toBe('1943-05 – 1944-02-10')
  })

  it('marks an unknown start', () => {
    expect(formatPeriod(null, '1944')).toBe('? – 1944')
  })
})

describe('PARTIAL_DATE_RE', () => {
  it.each(['1943', '1943-05', '1943-05-17'])('accepts %s', (d) => {
    expect(PARTIAL_DATE_RE.test(d)).toBe(true)
  })

  it.each(['43', '1943-5', '1943-05-1', '1943/05', ''])('rejects "%s"', (d) => {
    expect(PARTIAL_DATE_RE.test(d)).toBe(false)
  })
})

describe('comparePartial', () => {
  it('compares only the part both dates know', () => {
    expect(comparePartial('1943', '1943-05')).toBe(0)
    expect(comparePartial('1943-05', '1943-05-17')).toBe(0)
  })

  it('orders by the shared prefix', () => {
    expect(comparePartial('1942', '1943-01')).toBe(-1)
    expect(comparePartial('1944-01', '1943')).toBe(1)
    expect(comparePartial('1943-05-17', '1943-06')).toBe(-1)
  })
})
