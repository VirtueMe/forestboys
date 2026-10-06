/**
 * The heading outline of one description (#127).
 *
 * A description sits under the page's own section heading («Beskrivelse»), so a heading inside it
 * must fit below that one. HTML Standard 4.3.11: each heading following another must have a level
 * that is less than, equal to, or one greater than the one before. With the section heading as the
 * first «before», the rules are:
 *
 *   - a heading has text (an empty one renders as `<h3></h3>`)
 *   - it is not shallower than the section heading's child level: with the section at h2, no h1 or
 *     h2 (they collide with the page's headings)
 *   - it is at most one level deeper than the heading before it (the first: than the section)
 *   - going back up is allowed, down to that child level
 *
 * Pure, so the editor (before the PATCH) and the save endpoint can run the same check, and the
 * suggested repair is the same one however it is applied. Nothing here rewrites content on its own:
 * `fixHeadings` returns new blocks for the caller to offer.
 */

import type { SanityBlock } from './portableText.ts'

export type HeadingReason = 'empty' | 'too-shallow' | 'too-deep'

export interface HeadingProblem {
  blockKey:  string
  /** The words of the heading. */
  text:      string
  /** The level it has, 1 to 6. */
  level:     number
  reason:    HeadingReason
  /** The level it may have here: at most this (`too-deep`), at least this (`too-shallow`); null when empty. */
  allowed:   number | null
  /** What the repair makes of it: a level, or null when it becomes a plain paragraph (empty). */
  suggested: number | null
}

export interface OutlineOptions {
  /** The level of the heading above the description. The page's section heading is h2 today (#132). */
  sectionLevel?: number
}

const DEFAULT_SECTION_LEVEL = 2
const MAX_LEVEL = 6

/** 1 to 6 for h1 to h6, else null. */
export function headingLevel(style: string | undefined): number | null {
  const m = /^h([1-6])$/.exec(style ?? '')
  return m ? Number(m[1]) : null
}

const textOf = (block: SanityBlock) => (block.children ?? []).map(c => c.text ?? '').join('')

interface Heading { block: SanityBlock; level: number; text: string }

function headingsOf(blocks: unknown): Heading[] {
  if (!Array.isArray(blocks)) return []
  const out: Heading[] = []
  for (const b of blocks as SanityBlock[]) {
    if (b?._type !== 'block') continue
    const level = headingLevel(b.style)
    if (level !== null) out.push({ block: b, level, text: textOf(b) })
  }
  return out
}

const sectionOf = (o?: OutlineOptions) => o?.sectionLevel ?? DEFAULT_SECTION_LEVEL

/**
 * The level each heading should have: its place in the nesting of the source levels, below the
 * section heading. Walk the headings in order with a stack of their source levels, pop while the
 * top is not shallower than this heading, and the new level is the section level plus the depth of
 * the stack, capped at h6. An empty heading gets null (a plain paragraph) and is not part of the
 * nesting. Always satisfies the rules.
 */
function repair(headings: Heading[], section: number): Map<string, number | null> {
  const out = new Map<string, number | null>()
  const stack: number[] = []
  for (const h of headings) {
    if (h.text.trim() === '') { out.set(h.block._key, null); continue }
    while (stack.length > 0 && stack[stack.length - 1] >= h.level) stack.pop()
    stack.push(h.level)
    out.set(h.block._key, Math.min(section + stack.length, MAX_LEVEL))
  }
  return out
}

/** The headings that break the rules, in document order. Empty when the outline is valid. */
export function checkHeadings(blocks: unknown, options?: OutlineOptions): HeadingProblem[] {
  const section   = sectionOf(options)
  const headings  = headingsOf(blocks)
  const suggested = repair(headings, section)
  const problems: HeadingProblem[] = []
  // The level the next heading is measured against. A heading that is too shallow counts as the
  // section heading itself, so it is reported once and does not spoil the ones after it.
  let before = section

  for (const h of headings) {
    const base = { blockKey: h.block._key, text: h.text.trim(), level: h.level, suggested: suggested.get(h.block._key) ?? null }
    if (h.text.trim() === '') {
      problems.push({ ...base, reason: 'empty', allowed: null })
      continue
    }
    if (h.level <= section) {
      problems.push({ ...base, reason: 'too-shallow', allowed: section + 1 })
      before = section
      continue
    }
    if (h.level > before + 1) problems.push({ ...base, reason: 'too-deep', allowed: before + 1 })
    before = h.level
  }
  return problems
}

/**
 * The blocks with the repair applied: every heading moved to the level it should have, an empty
 * one turned into a plain paragraph. Everything else is untouched; the input is not changed.
 */
export function fixHeadings<T>(blocks: T, options?: OutlineOptions): T {
  if (!Array.isArray(blocks)) return blocks
  const levels = repair(headingsOf(blocks), sectionOf(options))
  return (blocks as SanityBlock[]).map(b => {
    if (!levels.has(b?._key)) return b
    const level = levels.get(b._key)
    return { ...b, style: level === null || level === undefined ? 'normal' : `h${level}` }
  }) as unknown as T
}

/** One line for a refused save, in Norwegian like the link problems. */
export function headingMessage(p: HeadingProblem, options?: OutlineOptions): string {
  const section = sectionOf(options)
  const name    = p.text ? `«${p.text}»` : 'Tom overskrift'
  switch (p.reason) {
    case 'empty':
      return `${name} (H${p.level}) har ingen tekst. Skriv en tekst eller gjør den om til vanlig tekst.`
    case 'too-shallow':
      return `${name} er H${p.level}, men seksjonen har allerede en H${section}. Her må en overskrift være H${p.allowed} eller dypere.`
    case 'too-deep':
      return `${name} er H${p.level}, men kan være høyst H${p.allowed} her.`
  }
}
