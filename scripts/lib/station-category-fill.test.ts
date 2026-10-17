import { describe, expect, it } from 'vitest'
import { planStationCategories, tidyStationType } from './station-category-fill.ts'

const st = (slug: string, type: string | null, category: unknown = null) => ({ slug, name: slug, type, category })

describe('tidyStationType', () => {
  it('fixes the misspellings of Airfield and tidies whitespace', () => {
    expect(tidyStationType('Airfiel')).toBe('Airfield')
    expect(tidyStationType('Airfiield')).toBe('Airfield')
    expect(tidyStationType('Airfiled')).toBe('Airfield')
    expect(tidyStationType('Airfield ')).toBe('Airfield')
    expect(tidyStationType('  MTB   base ')).toBe('MTB base')
  })

  it('keeps the specific types', () => {
    expect(tidyStationType('Sea plane station')).toBe('Sea plane station')
  })

  it('drops coordinates held as a type', () => {
    expect(tidyStationType('53.443815,')).toBeNull()
    expect(tidyStationType('53.44, -2.98')).toBeNull()
  })

  it('is null for nothing', () => {
    expect(tidyStationType(null)).toBeNull()
    expect(tidyStationType('  ')).toBeNull()
  })
})

describe('planStationCategories', () => {
  const plan = planStationCategories([
    st('a', 'Airfield'),
    st('b', 'Airfiel'),
    st('c', 'Sea plane station'),
    st('d', 'SOE Training School'),
    st('e', 'Lighthouse'),
    st('f', '53.443815,'),
    st('g', null),
    st('h', 'Airfield', 'training'),
  ])

  it('fills the category the type suggests', () => {
    expect(plan.fills.map(f => [f.slug, f.category])).toEqual([
      ['a', 'airfield'], ['b', 'airfield'], ['c', 'airfield'], ['d', 'training'],
    ])
  })

  it('lists what suggests nothing, with the type as it was', () => {
    expect(plan.unclear).toEqual([
      { slug: 'e', name: 'e', type: 'Lighthouse' },
      { slug: 'f', name: 'f', type: '53.443815,' },
      { slug: 'g', name: 'g', type: null },
    ])
  })

  it('never touches a category that is set', () => {
    expect(plan.kept).toBe(1)
    expect(plan.fills.find(f => f.slug === 'h')).toBeUndefined()
  })

  it('rewrites only the types that change', () => {
    expect(plan.types).toEqual([
      { slug: 'b', from: 'Airfiel', to: 'Airfield' },
      { slug: 'f', from: '53.443815,', to: null },
    ])
  })
})
