import { describe, expect, it } from 'vitest'
import { PARTIAL_DATE_RE, comparePartial, formatDateLong, formatEventPeriod, formatPeriod } from './period'

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

describe('formatDateLong', () => {
  it.each([
    ['1945', '1945'],
    ['1945-04', 'april 1945'],
    ['1945-04-12', '12. april 1945'],
    ['1945-05-01', '1. mai 1945'],
  ])('shows %s as «%s»', (date, shown) => {
    expect(formatDateLong(date)).toBe(shown)
  })

  it('shows what is not a date as it is', () => {
    expect(formatDateLong('vår 1943')).toBe('vår 1943')
    expect(formatDateLong('1943-13')).toBe('1943-13')
  })
})

describe('formatEventPeriod', () => {
  it('is empty without dates', () => {
    expect(formatEventPeriod(null, undefined)).toBe('')
  })

  it('is the start alone without an end, or with the same end', () => {
    expect(formatEventPeriod('1943-02-16', null)).toBe('16. februar 1943')
    expect(formatEventPeriod('1943-02-16', '1943-02-16')).toBe('16. februar 1943')
  })

  it('does not repeat the month and year both ends share', () => {
    expect(formatEventPeriod('1945-04-12', '1945-04-15')).toBe('12.–15. april 1945')
    expect(formatEventPeriod('1945-04-12', '1945-05-03')).toBe('12. april – 3. mai 1945')
    expect(formatEventPeriod('1945-04', '1945-05')).toBe('april – mai 1945')
  })

  it('writes both ends out across a new year', () => {
    expect(formatEventPeriod('1944-12-28', '1945-01-03')).toBe('28. desember 1944 – 3. januar 1945')
    expect(formatEventPeriod('1942', '1945')).toBe('1942 – 1945')
  })

  it('shows an end without a start', () => {
    expect(formatEventPeriod(null, '1943-02')).toBe('– februar 1943')
  })
})
