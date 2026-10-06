import { describe, expect, it } from 'vitest'
// The package of the DESIGN.md format has its own contrast ratio: an independent implementation to check ours against.
import { contrastRatio as packageRatio } from '@google/design.md/linter'
import { contrastRatio, isLargeText, judgeText, luminance, over, parseCssColor, type TextSample } from './contrast.ts'

const rgb = (r: number, g: number, b: number, a = 1) => ({ r, g, b, a })
const WHITE = rgb(255, 255, 255)
const BLACK = rgb(0, 0, 0)

describe('parseCssColor', () => {
  it.each([
    ['rgb(28, 26, 23)', rgb(28, 26, 23)],
    ['rgba(0, 0, 0, 0.5)', rgb(0, 0, 0, 0.5)],
    ['rgb(10 20 30)', rgb(10, 20, 30)],
    ['rgb(10 20 30 / 40%)', rgb(10, 20, 30, 0.4)],
    ['color(srgb 1 0.5 0 / 0.25)', rgb(255, 127.5, 0, 0.25)],
    ['transparent', rgb(0, 0, 0, 0)],
    ['RGB(1, 2, 3)', rgb(1, 2, 3)],
  ])('reads %s', (css, expected) => {
    expect(parseCssColor(css)).toEqual(expected)
  })

  it('says null for what it cannot read, so the caller can say so', () => {
    expect(parseCssColor('lab(50% 20 30)')).toBeNull()
    expect(parseCssColor('var(--ink)')).toBeNull()
    expect(parseCssColor('')).toBeNull()
  })
})

describe('contrastRatio', () => {
  it('is 21:1 for black on white, 1:1 for the same colour, either way round', () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 5)
    expect(contrastRatio(WHITE, BLACK)).toBeCloseTo(21, 5)
    expect(contrastRatio(rgb(90, 90, 90), rgb(90, 90, 90))).toBe(1)
  })

  it('agrees with the DESIGN.md package on the colours of the design and on a spread of others', () => {
    const colours = [
      [0x1c, 0x1a, 0x17], [0x25, 0x23, 0x20], [0xed, 0xe6, 0xd6], [0x92, 0x8a, 0x78], [0xce, 0x70, 0x60],
      [0xf4, 0xef, 0xe4], [0x68, 0x62, 0x57], [0x8b, 0x2e, 0x1f], [0, 0, 0], [255, 255, 255], [119, 119, 119], [200, 30, 99],
    ]
    for (const a of colours) {
      for (const b of colours) {
        const ours = contrastRatio(rgb(a[0], a[1], a[2]), rgb(b[0], b[1], b[2]))
        const theirs = packageRatio({ luminance: luminance(rgb(a[0], a[1], a[2])) } as never, { luminance: luminance(rgb(b[0], b[1], b[2])) } as never)
        expect(ours).toBeCloseTo(theirs, 10)
      }
    }
  })

  it('the first 4.5:1 grey on white is #767676, and #777777 just misses', () => {
    expect(contrastRatio(rgb(0x76, 0x76, 0x76), WHITE)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(rgb(0x77, 0x77, 0x77), WHITE)).toBeLessThan(4.5)
  })
})

describe('over', () => {
  it('lays a half-transparent black over white as mid grey, and leaves an opaque one alone', () => {
    expect(over(rgb(0, 0, 0, 0.5), WHITE)).toEqual(rgb(127.5, 127.5, 127.5, 1))
    expect(over(rgb(10, 20, 30, 1), WHITE)).toEqual(rgb(10, 20, 30, 1))
    expect(over(rgb(10, 20, 30, 0), rgb(1, 2, 3))).toEqual(rgb(1, 2, 3, 1))
  })
})

describe('isLargeText', () => {
  it.each([
    [24, 400, true], [23.9, 400, false], [18.66, 700, true], [18.66, 600, false], [18, 700, false], [14, 700, false],
  ])('%ipx at weight %i is large: %s', (size, weight, large) => {
    expect(isLargeText(size, weight)).toBe(large)
  })
})

describe('judgeText', () => {
  const sample = (over: Partial<TextSample> = {}): TextSample => ({
    text: 'Hei', where: 'p', color: 'rgb(0, 0, 0)', opacity: 1, backgrounds: ['rgb(255, 255, 255)'], fontSize: 16, fontWeight: 400, ...over,
  })

  it('passes readable text, and counts it', () => {
    const r = judgeText([sample(), sample({ color: 'rgb(0, 0, 0)' })])
    expect(r).toEqual({ violations: [], notJudged: [], passed: 2, decorative: 0 })
  })

  it('fails normal text below 4.5:1 and passes the same colours as large text', () => {
    const grey = 'rgb(119, 119, 119)'                       // 4.48:1 on white
    expect(judgeText([sample({ color: grey })]).violations).toHaveLength(1)
    expect(judgeText([sample({ color: grey, fontSize: 24 })]).violations).toEqual([])
    expect(judgeText([sample({ color: grey, fontSize: 18.66, fontWeight: 700 })]).violations).toEqual([])
  })

  it('reports the ratio, what was required, both colours, and where', () => {
    const [v] = judgeText([sample({ color: 'rgb(119, 119, 119)', text: 'Grå tekst', where: 'section > p' })]).violations
    expect(v).toMatchObject({ ratio: 4.48, required: 4.5, fg: '#777777', bg: '#FFFFFF', large: false, count: 1 })
    expect(v.examples).toEqual(['«Grå tekst» at section > p'])
  })

  it('judges the colour that reaches the eye: a colour alpha and an element opacity both thin the text', () => {
    // black at 50% alpha on white is #808080, 3.95:1
    expect(judgeText([sample({ color: 'rgba(0, 0, 0, 0.5)' })]).violations).toHaveLength(1)
    // black text in an element at opacity .5: the same
    expect(judgeText([sample({ opacity: 0.5 })]).violations).toHaveLength(1)
    // 80% is fine
    expect(judgeText([sample({ opacity: 0.8 })]).violations).toEqual([])
  })

  it('lays the background layers on top of one another, farthest first', () => {
    // a dark card with a faint white wash on it, light text: the wash lifts the dark, and the text passes
    const ok = sample({ color: 'rgb(230, 230, 230)', backgrounds: ['rgba(255, 255, 255, 0.1)', 'rgb(34, 34, 34)'] })
    expect(judgeText([ok]).passed).toBe(1)
    // the same layers, with the wash opaque white: light text on white fails
    const bad = sample({ color: 'rgb(230, 230, 230)', backgrounds: ['rgb(255, 255, 255)', 'rgb(34, 34, 34)'] })
    expect(judgeText([bad]).violations).toHaveLength(1)
  })

  it('assumes a white page where no layer is opaque, as a browser does', () => {
    expect(judgeText([sample({ backgrounds: [] })]).passed).toBe(1)
    expect(judgeText([sample({ color: 'rgb(255, 255, 255)', backgrounds: [] })]).violations).toHaveLength(1)
  })

  it('leaves out a decorative glyph and counts it, and judges words that are merely hidden from assistive technology', () => {
    const faint = { color: 'rgb(221, 221, 221)' }
    const r = judgeText([sample({ ...faint, text: '·', decorative: true }), sample({ ...faint, text: 'Skjult for skjermleser, men synlig' })])
    expect(r.decorative).toBe(1)
    expect(r.violations).toHaveLength(1)                       // the words still fail: the eye reads them
    expect(r.violations[0].examples[0]).toContain('Skjult for skjermleser')
  })

  it('does not judge text over an image or a gradient, and says so', () => {
    const r = judgeText([sample({ backgrounds: null, text: 'På bilde', where: 'figure > figcaption' })])
    expect(r.violations).toEqual([])
    expect(r.passed).toBe(0)
    expect(r.notJudged).toEqual([{ reason: 'text over an image or a gradient', count: 1, examples: ['«På bilde» at figure > figcaption'] }])
  })

  it('does not judge a colour it cannot read, and says so, and never counts it as passed', () => {
    const r = judgeText([sample({ color: 'lab(50% 20 30)' }), sample({ backgrounds: ['var(--x)'] })])
    expect(r.passed).toBe(0)
    expect(r.notJudged.map(n => n.reason)).toEqual([
      'a text colour that could not be read: lab(50% 20 30)',
      'a background colour that could not be read: var(--x)',
    ])
  })

  it('groups what is alike, most frequent first, with at most three examples', () => {
    const bad = (i: number) => sample({ color: 'rgb(119, 119, 119)', text: `rad ${i}` })
    const other = sample({ color: 'rgb(150, 150, 150)', text: 'annen' })
    const r = judgeText([bad(1), other, bad(2), bad(3), bad(4), bad(5)])
    expect(r.violations.map(v => [v.fg, v.count])).toEqual([['#777777', 5], ['#969696', 1]])
    expect(r.violations[0].examples).toHaveLength(3)
  })
})
