import { describe, expect, it } from 'vitest'
import { importableLinks, isImportableUrl, linkSource, urlToId } from './person-rule.ts'

const link = (l: string, title?: string) => ({ link: l, title })

describe('importableLinks', () => {
  it('imports an address with a leading space, trimmed', () => {
    expect(importableLinks([link(' https://www.unithistories.com/officers/RNVR_officersH.html', 'RNVR H')])).toEqual([
      { url: 'https://www.unithistories.com/officers/RNVR_officersH.html', title: 'RNVR H' },
    ])
  })

  it('trims a trailing space, tabs and line breaks too', () => {
    expect(importableLinks([link('https://a.example/x '), link('\thttps://b.example/y\n')]).map(l => l.url))
      .toEqual(['https://a.example/x', 'https://b.example/y'])
  })

  it('keeps one entry for an address written twice, whatever the padding; the last title wins', () => {
    expect(importableLinks([link('https://a.example/x', 'first'), link(' https://a.example/x ', 'second')]))
      .toEqual([{ url: 'https://a.example/x', title: 'second' }])
  })

  it('leaves out what is not an http(s) address, empty or missing', () => {
    expect(importableLinks([link(''), link('   '), link('ftp://a.example/x'), link('www.a.example'), {}, { link: 5 }, null]))
      .toEqual([])
  })

  it('gives nothing for a missing or malformed links field', () => {
    expect(importableLinks(undefined)).toEqual([])
    expect(importableLinks('https://a.example')).toEqual([])
  })

  it('keeps document order', () => {
    expect(importableLinks([link('https://b.example'), link('https://a.example')]).map(l => l.url))
      .toEqual(['https://b.example', 'https://a.example'])
  })

  it('gives the same Source id and url for a padded address as for the clean one', () => {
    const [padded] = importableLinks([link('  https://a.example/x')])
    expect(linkSource(padded.url, undefined)).toEqual(linkSource('https://a.example/x', undefined))
    expect(urlToId(padded.url)).toBe(urlToId('https://a.example/x'))
  })
})

describe('isImportableUrl', () => {
  it('tests the address as given: trimming is importableLinks’ job', () => {
    expect(isImportableUrl('https://a.example')).toBe(true)
    expect(isImportableUrl(' https://a.example')).toBe(false)
  })
})
