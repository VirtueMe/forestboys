import { describe, expect, it } from 'vitest'
import { parseChangelog, parseInline } from './changelog'
import { versionLabel } from './versionLabel'

const SAMPLE = `# Changelog

## [0.1.1](https://github.com/o/r/compare/v0.1.0...v0.1.1) (2026-10-03)


### Bug fixes

* **auth:** show why a sign-in failed ([226b216](https://github.com/o/r/commit/226b216))
* **pwa:** let /auth bypass the service worker ([2e86075](https://github.com/o/r/commit/2e86075)), closes [#14](https://github.com/o/r/issues/14)

## 0.1.0 (2026-10-02)


### Features

* **auth:** sign in with GitHub ([5d3f271](https://github.com/o/r/commit/5d3f271))


### Documentation

* rewrite README
`

describe('parseChangelog', () => {
  const releases = parseChangelog(SAMPLE)

  it('reads releases newest first as written, with and without a compare link', () => {
    expect(releases.map(r => [r.version, r.date])).toEqual([['0.1.1', '2026-10-03'], ['0.1.0', '2026-10-02']])
  })

  it('groups items under their section', () => {
    expect(releases[0].sections.map(s => [s.title, s.items.length])).toEqual([['Bug fixes', 2]])
    expect(releases[1].sections.map(s => [s.title, s.items.length])).toEqual([['Features', 1], ['Documentation', 1]])
  })

  it('returns nothing for text without releases', () => {
    expect(parseChangelog('# Changelog\n\nNothing yet.')).toEqual([])
    expect(parseChangelog('')).toEqual([])
  })

  it('ignores list items before the first release or section', () => {
    expect(parseChangelog('* stray\n## 1.0.0 (2026-01-01)\n* also stray')).toEqual([
      { version: '1.0.0', date: '2026-01-01', sections: [] },
    ])
  })
})

describe('parseInline', () => {
  it('splits bold, links and plain text', () => {
    expect(parseInline('**auth:** done ([abc](https://x.test/c)), closes [#1](https://x.test/1)')).toEqual([
      { text: 'auth:', bold: true },
      { text: ' done (' },
      { text: 'abc', href: 'https://x.test/c' },
      { text: '), closes ' },
      { text: '#1', href: 'https://x.test/1' },
    ])
  })

  it('keeps only http(s) links as links', () => {
    expect(parseInline('[x](javascript:alert(1))')).toEqual([{ text: 'x' }, { text: ')' }])
    expect(parseInline('[x](/relative)')).toEqual([{ text: 'x' }])
  })

  it('leaves HTML as plain text for the template to escape', () => {
    expect(parseInline('<b>x</b>')).toEqual([{ text: '<b>x</b>' }])
  })
})

describe('versionLabel', () => {
  it('shows version and commit', () => {
    expect(versionLabel('0.2.0', 'c0159c5')).toBe('v0.2.0 · c0159c5')
  })

  it('shows just the version when the commit is unknown', () => {
    expect(versionLabel('0.2.0', '')).toBe('v0.2.0')
  })

  it('shows how many commits the build is past the release', () => {
    expect(versionLabel('0.2.0', 'c0159c5', 7)).toBe('v0.2.0 +7 · c0159c5')
    expect(versionLabel('0.2.0', 'c0159c5', 0)).toBe('v0.2.0 · c0159c5')
  })
})
