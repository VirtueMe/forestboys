import { describe, expect, it } from 'vitest'
import { sortEvents, type EventListItem } from './eventList'

const ev = (title: string, startDate?: string | null, endDate?: string | null): EventListItem => ({ slug: title.toLowerCase(), title, startDate, endDate })
const titles = (items: EventListItem[]) => items.map(e => e.title)

describe('sortEvents', () => {
  const items = [ev('Uten dato'), ev('Grouse', '1942-10-18', '1943-02-27'), ev('Gunnerside', '1943-02-16'), ev('Bare slutt', null, '1942-05')]

  it('puts the oldest first and the undated last', () => {
    expect(titles(sortEvents(items))).toEqual(['Bare slutt', 'Grouse', 'Gunnerside', 'Uten dato'])
  })

  it('puts the newest first and still the undated last', () => {
    expect(titles(sortEvents(items, false))).toEqual(['Gunnerside', 'Grouse', 'Bare slutt', 'Uten dato'])
  })

  it('sorts the same date, and dates that agree as far as both go, by title', () => {
    expect(titles(sortEvents([ev('Øst', '1943'), ev('Alfa', '1943-05-17'), ev('Beta', '1943-05')]))).toEqual(['Alfa', 'Beta', 'Øst'])
  })

  it('leaves the list it was given alone', () => {
    const given = [ev('B', '1944'), ev('A', '1943')]
    sortEvents(given)
    expect(titles(given)).toEqual(['B', 'A'])
  })
})
