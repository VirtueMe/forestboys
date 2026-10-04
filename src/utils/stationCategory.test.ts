import { describe, expect, it } from 'vitest'
import { isStationCategory, suggestStationCategory } from './stationCategory.ts'

describe('suggestStationCategory', () => {
  it.each([
    ['SOE Training School', 'training'],
    ['SIS school for agents', 'training'],
    ['Skole', 'training'],
    ['Commando Training School', 'training'],
    ['Military academy', 'training'],
    ['Airfield', 'base'],
    ['Airfiled', 'base'],
    ['Airfiield', 'base'],
    ['MTB Station', 'base'],
    ['Fiskeskøytebase 41-42', 'base'],
    ['Sjøflyhavn', 'base'],
    ['Port of incoming convoys', 'base'],
    ['Scrapped', 'other'],
    ['Inter-Services Research Bureau', 'other'],
    ['53.443815, ', 'other'],
  ])('suggests %s → %s', (type, expected) => {
    expect(suggestStationCategory(type)).toBe(expected)
  })

  it('says nothing for an empty or unknown type', () => {
    expect(suggestStationCategory(null)).toBeNull()
    expect(suggestStationCategory('  ')).toBeNull()
    expect(suggestStationCategory('Lighthouse')).toBeNull()
  })
})

describe('isStationCategory', () => {
  it('accepts the three values only', () => {
    expect(isStationCategory('training')).toBe(true)
    expect(isStationCategory('base')).toBe(true)
    expect(isStationCategory('other')).toBe(true)
    expect(isStationCategory('school')).toBe(false)
    expect(isStationCategory(null)).toBe(false)
  })
})
