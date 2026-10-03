import { describe, expect, it } from 'vitest'
import { SLUG_RE, slugify } from './slug'

describe('slugify', () => {
  it('lower-cases and hyphenates words', () => {
    expect(slugify('Kompani Linge')).toBe('kompani-linge')
  })

  it('transliterates Norwegian letters', () => {
    expect(slugify('Sørlandet')).toBe('sorlandet')
    expect(slugify('Ålesund')).toBe('alesund')
    expect(slugify('Æresgave')).toBe('aeresgave')
  })

  it('strips diacritics from other letters', () => {
    expect(slugify('Café Müller')).toBe('cafe-muller')
  })

  it('drops punctuation and collapses whitespace and hyphens', () => {
    expect(slugify('  Operasjon   Freshman!! (1942) ')).toBe('operasjon-freshman-1942')
    expect(slugify('a - - b')).toBe('a-b')
  })

  it('produces output that passes SLUG_RE', () => {
    expect(SLUG_RE.test(slugify('Møre og Romsdal'))).toBe(true)
  })
})
