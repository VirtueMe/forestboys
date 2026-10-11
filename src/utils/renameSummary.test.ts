import { describe, expect, it } from 'vitest'
import { linksSummary } from './renameSummary.ts'

describe('linksSummary', () => {
  it('counts links and descriptions, in the singular where it is one', () => {
    expect(linksSummary({ links: 12, descriptions: 5 })).toBe('12 lenker i 5 beskrivelser oppdateres til den nye adressen.')
    expect(linksSummary({ links: 1, descriptions: 1 })).toBe('1 lenke i 1 beskrivelse oppdateres til den nye adressen.')
    expect(linksSummary({ links: 2, descriptions: 1 })).toBe('2 lenker i 1 beskrivelse oppdateres til den nye adressen.')
  })
  it('says so when no link points at the old address', () => {
    expect(linksSummary({ links: 0, descriptions: 0 })).toBe('Ingen lenker i beskrivelser peker på den gamle adressen.')
  })
})
