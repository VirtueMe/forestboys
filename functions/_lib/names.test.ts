import { describe, expect, it } from 'vitest'
import { validateNames } from './names.ts'

const name = (over: Record<string, unknown> = {}) => ({ value: 'STS 47', type: 'later', ...over })

describe('validateNames', () => {
  it('accepts an empty list (removes all names)', () => {
    expect(validateNames([])).toEqual({ names: [] })
  })

  it('fills defaults and trims the value', () => {
    expect(validateNames([name({ value: '  STS 47 ' })])).toEqual({ names: [{
      id: null, value: 'STS 47', type: 'later', from: null, fromAbout: false, to: null, toAbout: false, sourceRefs: [],
    }] })
  })

  it('keeps partial dates, the about flags, the id and the source refs', () => {
    const r = validateNames([name({
      id: 'n1', from: '1943', fromAbout: true, to: '1944-05', sourceRefs: ['btr2#page:A163', 'btr2#page:A163'],
    })])
    expect(r).toEqual({ names: [{
      id: 'n1', value: 'STS 47', type: 'later', from: '1943', fromAbout: true, to: '1944-05', toAbout: false,
      sourceRefs: ['btr2#page:A163'],
    }] })
  })

  it('drops "about" on a date that is not there', () => {
    const r = validateNames([name({ fromAbout: true, toAbout: true })])
    expect(r).toMatchObject({ names: [{ from: null, fromAbout: false, to: null, toAbout: false }] })
  })

  it('treats an empty date string as open', () => {
    expect(validateNames([name({ from: '', to: '' })])).toMatchObject({ names: [{ from: null, to: null }] })
  })

  it.each([
    ['not a list', 'x', /liste/],
    ['not an object', [null], /Ugyldig navn/],
    ['an empty value', [name({ value: '  ' })], /tomt/],
    ['a too long value', [name({ value: 'x'.repeat(201) })], /langt/],
    ['an unknown type', [name({ type: 'nick' })], /Ugyldig type/],
    ['a bad date', [name({ from: '1943-13-40x' })], /Ugyldig dato/],
    ['an end before the start', [name({ from: '1944', to: '1943' })], /før startdato/],
    ['a non-boolean about flag', [name({ from: '1943', fromAbout: 'yes' })], /fromAbout/],
    ['a bad source ref', [name({ sourceRefs: ['a#oops'] })], /kildehenvisning/],
    ['a bad id', [name({ id: 5 })], /id/],
    ['the same name twice', [name(), name({ value: 'sts 47' })], /to ganger/],
  ])('rejects %s', (_label, input, message) => {
    const r = validateNames(input)
    expect(r).toHaveProperty('error')
    expect((r as { error: string }).error).toMatch(message)
  })

  it('allows the same value under two types', () => {
    expect(validateNames([name(), name({ type: 'alias' })])).toHaveProperty('names')
  })

  it('rejects more than the maximum', () => {
    const many = Array.from({ length: 51 }, (_, i) => name({ value: `n${i}` }))
    expect(validateNames(many)).toHaveProperty('error')
  })
})
