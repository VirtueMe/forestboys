import { describe, expect, it } from 'vitest'
import { checkAll, checkDesign, colorDrift, cssColors, KNOWN_BELOW_AA } from './check.ts'

/** A small document: `ok` passes, `bad` (#999999 on white, 2.85:1) is below AA. */
const doc = (extra = '') => `---
name: Test
colors:
  primary: "#000000"
  paper: "#FFFFFF"
  grey: "#999999"
components:
  ok:  {backgroundColor: "{colors.paper}", textColor: "{colors.primary}"}
  bad: {backgroundColor: "{colors.paper}", textColor: "{colors.grey}"}
${extra}---

## Overview

Test.
`

describe('the design documents', () => {
  it.each(checkAll())('$file passes the check', ({ problems }) => {
    expect(problems).toEqual([])
  })

  it('still lists only pairs that fail, per document', () => {
    // a guard on the list itself: every entry is theme:component and a ratio below 4.5
    for (const [key, ratio] of Object.entries(KNOWN_BELOW_AA)) {
      expect(key).toMatch(/^(light|dark):[a-z-]+$/)
      expect(Number(ratio)).toBeLessThan(4.5)
    }
  })
})

describe('checkDesign', () => {
  it('refuses a pair below AA that is not known', () => {
    const v = checkDesign('light', doc(), {})
    expect(v.problems).toHaveLength(1)
    expect(v.problems[0]).toMatch(/light:bad is below WCAG AA and is not a known pair/)
  })

  it('lets a known pair through, and reports it as a note', () => {
    const v = checkDesign('light', doc(), { 'light:bad': '2.85' })
    expect(v.problems).toEqual([])
    expect(v.notes).toContain('light:bad 2.85:1 (known, below AA)')
  })

  it('refuses a known pair whose ratio changed', () => {
    const v = checkDesign('light', doc(), { 'light:bad': '3.00' })
    expect(v.problems).toEqual(['light:bad changed from 3.00:1 to 2.85:1; update KNOWN_BELOW_AA'])
  })

  it('refuses a known pair that passes now, so the list only shrinks', () => {
    const fixed = doc().replace('"#999999"', '"#595959"')   // 7:1
    const v = checkDesign('light', fixed, { 'light:bad': '2.85' })
    expect(v.problems).toEqual(['light:bad is in KNOWN_BELOW_AA but passes now (or is gone); remove it'])
  })

  it('does not mix the themes: a dark entry is not judged against a light document', () => {
    expect(checkDesign('light', doc(), { 'light:bad': '2.85', 'dark:bad': '2.00' }).problems).toEqual([])
  })

  it('refuses a broken reference', () => {
    const broken = doc().replace('{colors.grey}', '{colors.nope}')
    const v = checkDesign('light', broken, {})
    expect(v.problems.some(p => p.startsWith('broken-ref'))).toBe(true)
  })

  it('returns the colours as upper-case hex', () => {
    expect(checkDesign('light', doc(), { 'light:bad': '2.85' }).colors).toEqual({ primary: '#000000', paper: '#FFFFFF', grey: '#999999' })
  })
})

describe('cssColors and colorDrift', () => {
  const css = `
:root {
  --ink:   #1A1A1A;
  --paper: #F4EFE4;
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.1);
}
@media (min-width: 900px) { :root { --size-body: 1rem; } }
@media (prefers-color-scheme: dark) {
  :root {
    --ink:   #EDE6D6;
    --paper: #1C1A17;
  }
}
body { color: #123456; }
`
  it('reads light from :root and dark from the dark media block, hex only', () => {
    expect(cssColors(css)).toEqual({
      light: { ink: '#1A1A1A', paper: '#F4EFE4' },
      dark:  { ink: '#EDE6D6', paper: '#1C1A17' },
    })
  })

  it('says so when the structure is not what it expects', () => {
    expect(() => cssColors('body { color: red }')).toThrow(/could not find/)
  })

  it('finds no drift when they agree, and compares primary with faded-red', () => {
    const c = { 'faded-red': '#8B2E1F', ink: '#1A1A1A' }
    expect(colorDrift({ primary: '#8B2E1F', 'faded-red': '#8B2E1F', ink: '#1A1A1A' }, c)).toEqual([])
    expect(colorDrift({ primary: '#000000', 'faded-red': '#8B2E1F', ink: '#1A1A1A' }, c)).toEqual(['primary is #000000 but faded-red is #8B2E1F'])
  })

  it('names a value that differs, and a token on one side only', () => {
    expect(colorDrift({ ink: '#111111', moss: '#4F5A3E' }, { ink: '#1A1A1A', rule: '#C8BFA9' })).toEqual([
      'ink: document #111111, main.css #1A1A1A',
      'moss (#4F5A3E) is in the document, not in main.css',
      'rule (#C8BFA9) is in main.css, not in the document',
    ])
  })
})
