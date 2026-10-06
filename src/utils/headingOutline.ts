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

/** The line above the list of refused headings, in the editor and in the server's answer. */
export const HEADINGS_REFUSED = 'Noen overskrifter følger ikke strukturen. Rett dem og lagre på nytt.'

export interface HeadingProblem {
  /** Where it is in the list of blocks that was checked. */
  index:     number
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

interface Heading { index: number; block: SanityBlock; level: number; text: string }

function headingsOf(blocks: unknown): Heading[] {
  if (!Array.isArray(blocks)) return []
  const out: Heading[] = []
  ;(blocks as SanityBlock[]).forEach((b, index) => {
    if (b?._type !== 'block') return
    // A list item is never a heading on the page (blocksToHtml checks listItem first), so it is none here (#144).
    if (b.listItem) return
    const level = headingLevel(b.style)
    if (level !== null) out.push({ index, block: b, level, text: textOf(b) })
  })
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
function repair(headings: Heading[], section: number): Map<number, number | null> {
  const out = new Map<number, number | null>()
  const stack: number[] = []
  for (const h of headings) {
    if (h.text.trim() === '') { out.set(h.index, null); continue }
    while (stack.length > 0 && stack[stack.length - 1] >= h.level) stack.pop()
    stack.push(h.level)
    out.set(h.index, Math.min(section + stack.length, MAX_LEVEL))
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
    const base = { index: h.index, blockKey: h.block._key, text: h.text.trim(), level: h.level, suggested: suggested.get(h.index) ?? null }
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
  return (blocks as SanityBlock[]).map((b, i) => (levels.has(i) ? withLevel(b, levels.get(i) ?? null) : b)) as unknown as T
}

/** A heading block at another level; null makes it a plain paragraph. The same block when it already is. */
const withLevel = (b: SanityBlock, level: number | null): SanityBlock => {
  const style = level === null ? 'normal' : `h${level}`
  return b.style === style ? b : { ...b, style }
}

/**
 * The same, for a description kept as several sections, each a JSON string of blocks (the shape
 * the editor and the endpoints hold). The sections are read in order as one outline, because the
 * page shows them one after another under one section heading. Content that is not JSON, or not a
 * list, counts as no blocks.
 */
export interface ContentHeadingProblem extends HeadingProblem {
  /** Which of the contents it is in, and where among that content's blocks. */
  content: number
  local:   number
}

const parse = (content: string): unknown[] => {
  try { const v = JSON.parse(content) as unknown; return Array.isArray(v) ? v : [] } catch { return [] }
}

function join(contents: string[]) {
  const blocks: unknown[] = []
  const origin: { content: number; local: number }[] = []
  contents.forEach((c, content) => parse(c).forEach((b, local) => { blocks.push(b); origin.push({ content, local }) }))
  return { blocks, origin }
}

export function checkContents(contents: string[], options?: OutlineOptions): ContentHeadingProblem[] {
  const { blocks, origin } = join(contents)
  return checkHeadings(blocks, options).map(p => ({ ...p, ...origin[p.index] }))
}

/** The contents with the repair applied. A content that did not change comes back as the same string. */
export function fixContents(contents: string[], options?: OutlineOptions): string[] {
  const { blocks, origin } = join(contents)
  const fixed = fixHeadings(blocks, options)
  const changed = new Set<number>()
  fixed.forEach((b, i) => { if (b !== blocks[i]) changed.add(origin[i].content) })
  return contents.map((c, i) => {
    if (!changed.has(i)) return c
    return JSON.stringify(fixed.filter((_, j) => origin[j].content === i))
  })
}

/** One heading moved to `level` (null: a plain paragraph), the rest as it was. */
export function setContentHeading(contents: string[], at: { content: number; local: number }, level: number | null): string[] {
  return contents.map((c, i) => {
    if (i !== at.content) return c
    const blocks = parse(c) as SanityBlock[]
    if (!blocks[at.local]) return c
    return JSON.stringify(blocks.map((b, j) => (j === at.local ? withLevel(b, level) : b)))
  })
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
