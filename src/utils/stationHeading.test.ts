import { describe, expect, it } from 'vitest'
import { stationHeading } from './stationHeading'

const station = { slug: 's' }

describe('stationHeading', () => {
  it('is Base for an incident, whichever station it has', () => {
    expect(stationHeading('incident', station, null)).toBe('Base')
    expect(stationHeading('incident', null, station)).toBe('Base')
    expect(stationHeading('incident', station, station)).toBe('Base')
  })

  it('is Base for an event with no kind', () => {
    expect(stationHeading(undefined, station, null)).toBe('Base')
  })

  it('is Stasjoner for an operation with a station at both ends', () => {
    expect(stationHeading('operation', station, station)).toBe('Stasjoner')
  })

  it('is Fra Base for an operation with only a from-station', () => {
    expect(stationHeading('operation', station, null)).toBe('Fra Base')
  })

  it('is Til Base for an operation with only a to-station', () => {
    expect(stationHeading('operation', null, station)).toBe('Til Base')
  })
})
