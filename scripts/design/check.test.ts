import { describe, expect, it } from 'vitest'
import { checkAll, checkDesign, colorDrift, cssColors } from './check.ts'

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
  it.each(checkAll())('$file keeps the promise: every declared pair meets AA, and the colours are main.css\'s', ({ problems }) => {
    expect(problems).toEqual([])
  })
})

describe('checkDesign', () => {
  it('refuses a pair below AA', () => {
    const v = checkDesign('light', doc())
    expect(v.problems).toHaveLength(1)
    expect(v.problems[0]).toMatch(/^light:bad is below WCAG AA: textColor \(#999999\) on backgroundColor \(#ffffff\) has contrast ratio 2\.85:1/)
  })

  it('passes a document where every declared pair meets AA', () => {
    const fixed = doc().replace('"#999999"', '"#595959"')   // 7:1
    expect(checkDesign('light', fixed).problems).toEqual([])
  })

  it('names the theme, so a failure in the dark document says dark', () => {
    expect(checkDesign('dark', doc()).problems[0]).toMatch(/^dark:bad /)
  })

  it('refuses a broken reference', () => {
    const broken = doc().replace('{colors.grey}', '{colors.nope}')
    const v = checkDesign('light', broken)
    expect(v.problems.some(p => p.startsWith('broken-ref'))).toBe(true)
  })

  it('reports what else the linter says as notes, not failures', () => {
    const v = checkDesign('light', doc().replace('"#999999"', '"#595959"'))
    expect(v.problems).toEqual([])
    expect(v.notes.some(n => n.startsWith('token-summary'))).toBe(true)
  })

  it('returns the colours as upper-case hex', () => {
    expect(checkDesign('light', doc()).colors).toEqual({ primary: '#000000', paper: '#FFFFFF', grey: '#999999' })
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
