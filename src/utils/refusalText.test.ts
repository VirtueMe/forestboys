import { describe, expect, it } from 'vitest'
import { refusalsText, refusalText } from './refusalText.ts'

describe('refusalText', () => {
  it('says that the entity exists', () => {
    expect(refusalText({ prop: 'entity', expected: null, actual: 'exists' })).toBe('Finnes allerede i grafen.')
  })

  it('names the property and the two values', () => {
    expect(refusalText({ prop: 'title', expected: 'Linge', actual: 'Kompani Linge' }))
      .toBe('title er endret siden forslaget ble laget: forventet «Linge», nå «Kompani Linge».')
  })

  it('shows an empty or missing value, and a non-string one', () => {
    expect(refusalText({ prop: 'rank', expected: null, actual: 3 }))
      .toBe('rank er endret siden forslaget ble laget: forventet (tom), nå 3.')
  })

  it('joins several', () => {
    expect(refusalsText([
      { prop: 'a', expected: 'x', actual: 'y' },
      { prop: 'entity', expected: null, actual: 'exists' },
    ])).toContain('Finnes allerede i grafen.')
  })
})
