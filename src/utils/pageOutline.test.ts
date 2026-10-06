import { describe, expect, it } from 'vitest'
import { checkPageOutline, type HeadingSample } from './pageOutline.ts'

/** Headings from 'h1 Title, h2 Section, h2 Other', in order. */
const page = (spec: string): HeadingSample[] =>
  spec.split(',').map(s => s.trim()).filter(Boolean).map((s, i) => {
    const [tag, ...words] = s.split(' ')
    return { level: Number(tag.slice(1)), text: words.join(' '), where: `${tag}#${i}` }
  })
const reasons = (spec: string) => checkPageOutline(page(spec)).map(p => p.reason)

describe('checkPageOutline', () => {
  it.each([
    ['a title and sections', 'h1 Side, h2 A, h2 B'],
    ['sections with subsections, back up, and down again', 'h1 Side, h2 A, h3 A1, h4 A11, h3 A2, h2 B, h3 B1'],
    ['only an h1', 'h1 Side'],
    ['going back up by several levels', 'h1 Side, h2 A, h3 A1, h4 A11, h2 B'],
  ])('accepts %s', (_name, spec) => {
    expect(reasons(spec)).toEqual([])
  })

  it('refuses a page with no headings, and says so without a heading to point at', () => {
    expect(checkPageOutline([])).toEqual([{ reason: 'no-h1', heading: null, message: 'the page has no headings at all' }])
  })

  it('refuses a page whose first heading is not an h1', () => {
    expect(reasons('h2 A, h3 B')).toEqual(['no-h1'])
  })

  it('refuses a second h1', () => {
    expect(reasons('h1 Side, h2 A, h1 En til')).toEqual(['several-h1'])
  })

  it('refuses a heading before the h1', () => {
    expect(reasons('h2 Først, h1 Side, h2 A')).toEqual(['not-first'])
  })

  it('refuses a skipped level, once for each, and names the heading and what may come', () => {
    // the skip that #132 fixed: the title, then straight to h3
    const problems = checkPageOutline(page('h1 Side, h3 Beskrivelse, h5 For dypt'))
    expect(problems.map(p => p.reason)).toEqual(['too-deep', 'too-deep'])
    expect(problems[0].message).toBe('h3 «Beskrivelse» at h3#1 follows an h1; at most h2 may')
    expect(problems[1].message).toBe('h5 «For dypt» at h5#2 follows an h3; at most h4 may')
  })

  it('refuses a heading with no text', () => {
    expect(reasons('h1 Side, h2 , h2 Ok')).toEqual(['empty'])
    expect(reasons('h1 Side, h2    ')).toEqual(['empty'])
  })

  it('reports several problems on one page, in the order of the page', () => {
    expect(reasons('h2 Først, h4 Dypt, h1 A, h1 B')).toEqual(['several-h1', 'not-first', 'too-deep'])
  })
})
