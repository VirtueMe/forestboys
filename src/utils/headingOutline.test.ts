import { describe, expect, it } from 'vitest'
import { checkHeadings, fixHeadings, headingLevel, headingMessage } from './headingOutline.ts'
import type { SanityBlock } from './portableText.ts'

let n = 0
/** A block of the given style and text, with a key from its position. */
const b = (style: string, text = 'T'): SanityBlock => ({
  _key: `k${n++}`, _type: 'block', style,
  children: [{ _key: 's', _type: 'span', text }],
})
/** Headings from a sequence like 'h3 h4 p h3', where p is a paragraph. */
const seq = (spec: string) => spec.split(' ').filter(Boolean).map(t => b(t === 'p' ? 'normal' : t))
const levels = (blocks: SanityBlock[]) => blocks.map(x => x.style)
const problems = (spec: string, sectionLevel?: number) =>
  checkHeadings(seq(spec), { sectionLevel }).map(p => `${p.reason}:h${p.level}${p.allowed ? `→${p.allowed}` : ''}`)

describe('headingLevel', () => {
  it('reads h1 to h6 and nothing else', () => {
    expect(headingLevel('h4')).toBe(4)
    expect(headingLevel('h7')).toBeNull()
    expect(headingLevel('normal')).toBeNull()
    expect(headingLevel(undefined)).toBeNull()
  })
})

describe('checkHeadings, section heading at h2 (the default)', () => {
  it.each([
    ['no blocks', ''],
    ['no headings', 'p p'],
    ['one h3', 'h3'],
    ['h3 then deeper by one each time', 'h3 h4 h5 h6'],
    ['equal levels', 'h3 h3 h4 h4'],
    ['back up to h3 from h6', 'h3 h4 h5 h6 h3'],
    ['back up by several levels, then down again', 'h3 h4 h5 h4 h3 h4'],
    ['h6 repeated', 'h3 h4 h5 h6 h6 h6'],
    ['headings between paragraphs', 'p h3 p p h4 p'],
    ['a quote and normal text are not headings', 'blockquote h3 normal'],
  ])('accepts %s', (_name, spec) => {
    expect(problems(spec)).toEqual([])
  })

  it.each([
    ['an h1', 'h1', ['too-shallow:h1→3']],
    ['an h2: the section already has the h2', 'h2', ['too-shallow:h2→3']],
    ['a first heading that is not h3', 'h4', ['too-deep:h4→3']],
    ['a skipped level', 'h3 h5', ['too-deep:h5→4']],
    ['a skip after going back up', 'h3 h4 h5 h3 h5', ['too-deep:h5→4']],
    ['h1 first and then a normal h3: the h1 counts as the section heading', 'h1 h3', ['too-shallow:h1→3']],
    ['h1 first and then h4: measured against the section, not the h1', 'h1 h4', ['too-shallow:h1→3', 'too-deep:h4→3']],
    ['h2 at the end of a good outline', 'h3 h4 h2', ['too-shallow:h2→3']],
    ['several problems in order', 'h2 h3 h6 h1', ['too-shallow:h2→3', 'too-deep:h6→4', 'too-shallow:h1→3']],
  ])('refuses %s', (_name, spec, expected) => {
    expect(problems(spec)).toEqual(expected)
  })

  it('refuses an empty heading, also one with only spaces, and keeps it out of the levels', () => {
    const blocks = [b('h3'), b('h4', '   '), b('h4')]
    expect(checkHeadings(blocks).map(p => p.reason)).toEqual(['empty'])
    // the h4 after the empty one is measured against the h3 before it, so it is fine
  })

  it('reports the heading, its level and the level it may have', () => {
    const blocks = [b('h3', 'Start'), b('h5', 'For dypt')]
    expect(checkHeadings(blocks)).toEqual([{
      blockKey: blocks[1]._key, text: 'For dypt', level: 5, reason: 'too-deep', allowed: 4, suggested: 4,
    }])
  })

  it('ignores blocks that are not text blocks, and input that is not a list', () => {
    expect(checkHeadings([{ _key: 'x', _type: 'image', style: 'h1' }])).toEqual([])
    expect(checkHeadings(undefined)).toEqual([])
    expect(checkHeadings(null)).toEqual([])
    expect(checkHeadings('h1')).toEqual([])
  })
})

describe('checkHeadings with another section level', () => {
  it('under an h3 section (a popup of h4 would say 4), h4 is the first valid level', () => {
    expect(problems('h4 h5', 3)).toEqual([])
    expect(problems('h3', 3)).toEqual(['too-shallow:h3→4'])
    expect(problems('h5', 3)).toEqual(['too-deep:h5→4'])
  })
})

describe('fixHeadings', () => {
  const fixed = (spec: string, sectionLevel?: number) => levels(fixHeadings(seq(spec), { sectionLevel }))

  it('leaves a valid outline as it is', () => {
    expect(fixed('h3 h4 p h3 h4 h5')).toEqual(['h3', 'h4', 'normal', 'h3', 'h4', 'h5'])
  })

  it('nests by structure: an h1 with an h3 below becomes h3 with an h4 below', () => {
    expect(fixed('h1 h3 h5')).toEqual(['h3', 'h4', 'h5'])
  })

  it('brings a first heading that is too deep up to the first valid level', () => {
    expect(fixed('h5 h5 h6')).toEqual(['h3', 'h3', 'h4'])
  })

  it('keeps siblings level and returns to the right depth', () => {
    expect(fixed('h2 h4 h3 h4')).toEqual(['h3', 'h4', 'h4', 'h5'])
  })

  it('turns an empty heading into a plain paragraph', () => {
    const out = fixHeadings([b('h3'), b('h4', ''), b('h4')])
    expect(levels(out)).toEqual(['h3', 'normal', 'h4'])
  })

  it('stops at h6', () => {
    expect(fixed('h1 h2 h3 h4 h5 h6')).toEqual(['h3', 'h4', 'h5', 'h6', 'h6', 'h6'])
  })

  it('does not change the input, and keeps everything but the style', () => {
    const blocks = [{ ...b('h1', 'Hei'), markDefs: [{ _key: 'm', _type: 'link' }] }]
    const out = fixHeadings(blocks)
    expect(blocks[0].style).toBe('h1')
    expect(out[0]).toEqual({ ...blocks[0], style: 'h3' })
  })

  it('returns what is not a list as it came', () => {
    expect(fixHeadings(undefined)).toBeUndefined()
  })

  it.each([
    'h1', 'h6', 'h1 h6', 'h2 h2 h2', 'h6 h5 h4 h3 h2 h1', 'h3 h6 h3 h6', 'h1 h3 h2 h5 h4 h6 h1',
    'p h5 p h1 p h6', 'h4 h4 h4 h4 h4 h4', 'h1 h2 h3 h4 h5 h6 h5 h4 h3 h2 h1',
  ])('always produces an outline that passes the check: %s', spec => {
    for (const sectionLevel of [2, 3, 4]) {
      const out = fixHeadings(seq(spec), { sectionLevel })
      expect(checkHeadings(out, { sectionLevel })).toEqual([])
    }
  })
})

describe('headingMessage', () => {
  /** One heading from 'h1 Words of the heading'. */
  const msg = (spec: string) => {
    const [style, ...words] = spec.split(' ')
    return checkHeadings([b(style, words.join(' '))]).map(p => headingMessage(p))[0]
  }

  it('names the heading, its level and the level it may have', () => {
    expect(msg('h1 Om oss')).toBe('«Om oss» er H1, men seksjonen har allerede en H2. Her må en overskrift være H3 eller dypere.')
    expect(msg('h5 Dypt')).toBe('«Dypt» er H5, men kan være høyst H3 her.')
  })

  it('says it when the heading has no text', () => {
    const p = checkHeadings([b('h3', '')])[0]
    expect(headingMessage(p)).toBe('Tom overskrift (H3) har ingen tekst. Skriv en tekst eller gjør den om til vanlig tekst.')
  })
})
