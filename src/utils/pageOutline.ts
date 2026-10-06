/**
 * The heading outline of a whole page (#139), as the browser rendered it: the pure half. The browser
 * half (e2e/helpers/collect.ts) lists the visible headings in document order; this judges them.
 *
 * Not the same rule as headingOutline.ts, which judges the headings *inside* a description, below a
 * section heading that is already there. A page starts at its h1 (HTML Standard 4.3.11: each heading
 * may be at most one level deeper than the one before it; WAI: one h1 that names the page).
 *
 *   - exactly one h1, and it is the first heading
 *   - each heading at most one level deeper than the one before; going back up is free
 *   - no heading without text (it renders as nothing but is still in the outline)
 */

export interface HeadingSample {
  /** 1 to 6. */
  level: number
  /** What it says, or empty. */
  text: string
  /** A short path to its element, to find it by. */
  where: string
}

export type OutlineReason = 'no-h1' | 'several-h1' | 'not-first' | 'too-deep' | 'empty'

export interface OutlineProblem {
  reason: OutlineReason
  /** The heading it is about; null when the page has none at all. */
  heading: HeadingSample | null
  message: string
}

const at = (h: HeadingSample) => `h${h.level} «${h.text || '(empty)'}» at ${h.where}`

export function checkPageOutline(headings: HeadingSample[]): OutlineProblem[] {
  const problems: OutlineProblem[] = []
  const add = (reason: OutlineReason, heading: HeadingSample | null, message: string) => problems.push({ reason, heading, message })

  const h1s = headings.filter(h => h.level === 1)
  if (headings.length === 0) add('no-h1', null, 'the page has no headings at all')
  else if (h1s.length === 0) add('no-h1', headings[0], `the page has no h1; the first heading is ${at(headings[0])}`)
  if (h1s.length > 1) add('several-h1', h1s[1], `the page has ${h1s.length} h1 headings; the second is ${at(h1s[1])}`)
  if (h1s.length >= 1 && headings[0].level !== 1) add('not-first', headings[0], `a heading comes before the h1: ${at(headings[0])}`)

  let before = 0
  for (const h of headings) {
    if (h.text.trim() === '') add('empty', h, `a heading has no text: ${at(h)}`)
    if (before > 0 && h.level > before + 1) add('too-deep', h, `${at(h)} follows an h${before}; at most h${before + 1} may`)
    before = h.level
  }
  return problems
}
