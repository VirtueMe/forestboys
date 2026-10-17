import { describe, expect, it } from 'vitest'
import { sha, type Doc } from './person-sync.ts'
import { LINK_KINDS, classifyLinks, sanityLinkSources, sanityValue, stampsFor, type GraphLinks } from './link-sync.ts'

const A = 'https://a.example/x', B = 'https://b.example/y'
const link = (url: string, title?: string) => ({ link: url, title })
const doc = (links: unknown[], at = '2026-10-04T14:13:19Z'): Doc => ({ _id: 't1', _updatedAt: at, links })
const node = (links: string[], stamp?: string): GraphLinks => ({ sanityId: 't1', slug: 't', links, stamp })

describe('values', () => {
  it('trims an address and keeps one entry per address, in any order', () => {
    expect(sanityValue(doc([link(` ${B}`), link(A), link(A)]))).toBe(`${A}\n${B}`)
  })

  it('makes the same Source for a padded address as for the trimmed one (#113)', () => {
    expect(sanityLinkSources(doc([link(` ${A}`, 'T')]))).toEqual(sanityLinkSources(doc([link(A, 'T')])))
  })

  it('stamps the hash of the set and the version it came from', () => {
    expect(stampsFor(doc([link(A)]))).toEqual({ links_sha: sha(A), links_sanityUpdatedAt: '2026-10-04T14:13:19Z' })
  })
})

describe('classifyLinks, with a stamp', () => {
  const was = doc([link(A)], '2026-04-01T00:00:00Z')
  const stamp = stampsFor(was).links_sha

  it('leaves out a node Sanity has not changed since its stamp', () => {
    expect(classifyLinks(node([A], stamp), was)).toBe('unchanged')
  })

  it('applies a Sanity change while the graph holds the stamped set', () => {
    expect(classifyLinks(node([A], stamp), doc([link(A), link(B)]))).toBe('clean')
  })

  it('moves only the stamp when the graph already holds the new set', () => {
    expect(classifyLinks(node([A, B], stamp), doc([link(A), link(B)]))).toBe('already')
  })

  it('holds a node whose links were edited in the graph and changed in Sanity', () => {
    expect(classifyLinks(node([B], stamp), doc([link(A), link(B), link('https://c.example')]))).toBe('conflict')
  })
})

describe('classifyLinks, without a stamp', () => {
  it('finds the graph already right', () => {
    expect(classifyLinks(node([A]), doc([link(A)]))).toBe('already')
    expect(classifyLinks(node([]), doc([]))).toBe('already')
  })

  it('takes Sanity\'s links for a node that has none', () => {
    expect(classifyLinks(node([]), doc([link(A)]))).toBe('clean')
  })

  it('applies Sanity\'s change when the graph still holds the baseline\'s links', () => {
    expect(classifyLinks(node([A]), doc([link(A), link(B)]), doc([link(A)], '2026-04-01T00:00:00Z'))).toBe('clean')
  })

  it('only adds when Sanity is as in the baseline and the graph lacks a link: the import missed it (#113)', () => {
    const base = doc([link(` ${A}`), link(B)], '2026-04-01T00:00:00Z')
    expect(classifyLinks(node([B]), doc([link(` ${A}`), link(B)]), base)).toBe('gap')
  })

  it('holds a graph that differs from both the baseline and Sanity', () => {
    expect(classifyLinks(node(['https://c.example']), doc([link(A), link(B)]), doc([link(A)]))).toBe('conflict')
  })

  it('sends a differing graph to review when there is no baseline', () => {
    expect(classifyLinks(node([A]), doc([link(A), link(B)]))).toBe('review')
  })
})

describe('kinds', () => {
  it('has the graph label and Sanity type of each', () => {
    expect(Object.values(LINK_KINDS).map(k => [k.key, k.label, k.sanityType])).toEqual([
      ['transport', 'Transport', 'transport'], ['location', 'Location', 'location'], ['station', 'Station', 'station'],
      ['outline', 'Outline', 'outline'],
    ])
  })

  it('leaves the Linge members outline alone', () => {
    expect(LINK_KINDS.outline.skip?.has('917b8cb9-6a12-4a96-91eb-8444691d6797')).toBe(true)
  })
})
