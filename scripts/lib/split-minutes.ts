/**
 * Split the giant blocks of the ANCC minutes into one block per line, with the numbered items as
 * headings (#259).
 *
 * The minutes were imported as a few huge blocks: the item headings are underlined spans, and the
 * line breaks are `\n` inside the spans. This reads the lines back out. It only reshapes: the words
 * are the same, which `sameText` lets the caller check.
 *
 * Headings are promoted only when the line says so, and `fixHeadings` then makes them pass the save
 * check (first heading H3, none deeper than one level below the one before):
 *   - a block that is already a heading becomes H3 (the title of the meeting),
 *   - a line that is wholly strong or underlined and starts with `1.` becomes H4, with `(a)` H5,
 *   - such a line with no number becomes H4 when body text follows it in the same block,
 *   - a numbered heading with body text after it on the same line is cut into the heading and the
 *     paragraph, unless the text after it continues the heading (starts in lower case).
 * Everything else is a paragraph with its marks. A block laid out in columns (a tab that is not
 * after a marker, or a run of spaces inside a line) keeps its spacing, one line to a block.
 */

import { createHash } from 'node:crypto'
import { checkContents, fixHeadings } from '../../src/utils/headingOutline.ts'
import type { SanityBlock, SanityMarkDef, SanitySpan } from '../../src/utils/portableText.ts'

const EMPHASIS = ['strong', 'underline']
const MAX_HEADING = 160

interface Seg { text: string; marks: string[] }

const isEmphasis = (s: Seg) => s.marks.some(m => EMPHASIS.includes(m))
const isBlank = (s: Seg) => !s.text.trim()
const lineText = (segs: Seg[]) => segs.map(s => s.text).join('')

/** `1.`, `10.`, `3)` at the start. */
const NUMBERED = /^\d+[.)]\s*/
/** `(a)`, `(b)`, `(iv)`, `p.` at the start. */
const LETTERED = /^(\([A-Za-z0-9]{1,4}\)|[a-z]{1,2}\.)\s*/
/** The tab after an outline marker: `(a)⇥Item`, `1.⇥Item`. */
const MARKER_TAB = /^(\s*(?:\d+[.)]|\([A-Za-z0-9]{1,4}\)|[A-Za-z]{1,2}\.))\t\s*/
/** What follows a heading cut short: lower case or punctuation continues it. */
const CONTINUES = /^[a-zæøå.,;:)\]'"–-]/

/** A line that starts in lower case continues the one above it. */
const WRAPPED = /^[a-zæøå]/

/** A separator line: ten or more underscores, dashes or equals signs. */
const RULE = /^[_=-]{10,}$/

/** An archive reference, not a heading: `HS2-138 ANCC`. */
const ARCHIVE_REF = /^\(?HS\d?-\d+/

function toLines(block: SanityBlock): Seg[][] {
  const lines: Seg[][] = [[]]
  for (const child of block.children ?? []) {
    const parts = (child.text ?? '').split('\n')
    parts.forEach((part, i) => {
      if (i > 0) lines.push([])
      if (part) lines[lines.length - 1].push({ text: part, marks: child.marks ?? [] })
    })
  }
  return lines
}

/** A line in columns: a tab that does not follow a marker, or a run of spaces inside the text. */
function isColumnLine(text: string): boolean {
  const body = text.replace(MARKER_TAB, '')
  return body.includes('\t') || / {3,}/.test(body.trim())
}

function trimSegs(segs: Seg[]): Seg[] {
  const out = segs.map(s => ({ ...s }))
  while (out.length && isBlank(out[0])) out.shift()
  while (out.length && isBlank(out[out.length - 1])) out.pop()
  if (out.length) {
    out[0].text = out[0].text.replace(/^\s+/, '')
    out[out.length - 1].text = out[out.length - 1].text.replace(/\s+$/, '')
  }
  return out
}

/** The tab after a marker becomes a space: a short block with a tab would render as a table again (#256). */
function untab(segs: Seg[]): Seg[] {
  if (!segs.length) return segs
  const out = segs.map(s => ({ ...s }))
  out[0].text = out[0].text.replace(MARKER_TAB, '$1 ')
  return out
}

/** A heading says something beyond its number. */
const hasWords = (text: string) => text.replace(NUMBERED, '').replace(LETTERED, '').trim().length >= 3

function headingLevel(text: string): 4 | 5 {
  return NUMBERED.test(text) ? 4 : LETTERED.test(text) ? 5 : 4
}

/** A heading is spoken by its level: the emphasis marks go, a link stays. */
function plain(segs: Seg[]): Seg[] {
  return segs.map(s => ({ text: s.text, marks: s.marks.filter(m => !EMPHASIS.includes(m)) }))
}

function build(key: string, style: string, segs: Seg[], defs: SanityMarkDef[]): SanityBlock {
  const merged: Seg[] = []
  for (const s of segs) {
    const last = merged[merged.length - 1]
    if (last && last.marks.join() === s.marks.join()) last.text += s.text
    else merged.push({ ...s })
  }
  const used = new Set(merged.flatMap(s => s.marks))
  const children: SanitySpan[] = merged.map((s, i) => ({ _key: `${key}s${i}`, _type: 'span', text: s.text, marks: s.marks }))
  return { _key: key, _type: 'block', style, children, markDefs: defs.filter(d => used.has(d._key)) }
}

interface Item { raw?: SanityBlock; style: string; segs: Seg[]; defs: SanityMarkDef[]; column: boolean }

export function splitMinutes(blocks: SanityBlock[], seed: string): SanityBlock[] {
  const items: Item[] = []
  const emit = (style: string, segs: Seg[], defs: SanityMarkDef[], column = false) => items.push({ style, segs, defs, column })

  for (const block of blocks) {
    if (block._type !== 'block' || block.listItem) { items.push({ raw: block, style: '', segs: [], defs: [], column: false }); continue }
    const defs = block.markDefs ?? []

    if (/^h[1-6]$/.test(block.style ?? '')) {
      const segs = trimSegs(block.children?.map(c => ({ text: c.text ?? '', marks: c.marks ?? [] })) ?? [])
      if (segs.length) emit('h3', segs, defs)
      continue
    }

    const lines = toLines(block).map(trimSegs).filter(l => l.length)
    const from = items.length

    lines.forEach((line, i) => {
      const text = lineText(line)
      // A line in columns keeps its spacing and its tabs: the renderer decides what it is (#256).
      if (isColumnLine(text)) { emit('normal', line, defs, true); return }

      // A line that starts in lower case is the rest of the line above, wrapped.
      const prev = items.length > from ? items[items.length - 1] : null
      if (prev && prev.style === 'normal' && !prev.column && WRAPPED.test(text)) {
        prev.segs.push({ text: ' ', marks: [] }, ...line)
        return
      }

      const body = i < lines.length - 1
      const whole = line.every(s => isBlank(s) || isEmphasis(s))

      if (whole && text.length <= MAX_HEADING && !ARCHIVE_REF.test(text) && hasWords(text) && (NUMBERED.test(text) || LETTERED.test(text) || body)) {
        emit(`h${headingLevel(text)}`, plain(untab(line)), defs)
        return
      }

      const lead = line.findIndex(s => !isEmphasis(s))
      if (lead > 0) {
        const head = line.slice(0, lead)
        const rest = trimSegs(line.slice(lead))
        const headText = lineText(head).trim()
        if (rest.length && NUMBERED.test(headText) && hasWords(headText) && headText.length <= MAX_HEADING && !CONTINUES.test(lineText(rest))) {
          emit(`h${headingLevel(headText)}`, plain(untab(trimSegs(head))), defs)
          emit('normal', rest, defs)
          return
        }
      }
      emit('normal', untab(line), defs)
    })
  }

  const out = items.map((it, n) =>
    it.raw ?? build(createHash('sha1').update(`${seed}:${n}`).digest('hex').slice(0, 12), it.style, it.segs, it.defs))
  // The levels above are by the look of a line; the editor's own repair makes them pass the save check.
  return fixHeadings(out)
}

/** A mistake in the scan that someone has read and named: `from` becomes `to` in the text of `key`. */
export interface Correction { key: string; from: string; to: string; why?: string }

/**
 * The blocks with the corrections for `key` applied to the text of their spans. Each must match exactly once,
 * inside one span, or nothing is applied and the reason comes back: a correction that matches twice or not at
 * all is not one anyone read. Only the words are searched, never the keys and marks around them.
 */
export function applyCorrections(key: string, blocks: SanityBlock[], corrections: Correction[]): { blocks: SanityBlock[]; applied: string[] } | { error: string } {
  const flat = (t: string) => t.trim().replace(/\s+/g, ' ')
  const out = structuredClone(blocks)
  const spans = out.flatMap(b => b.children ?? [])
  const applied: string[] = []
  for (const c of corrections.filter(x => x.key === key)) {
    const hits = spans.filter(sp => (sp.text ?? '').includes(c.from))
    const n = hits.reduce((count, sp) => count + (sp.text ?? '').split(c.from).length - 1, 0)
    if (n !== 1) return { error: `correction «${flat(c.from)}» matches ${n} times, not once` }
    hits[0].text = (hits[0].text ?? '').replace(c.from, () => c.to)
    applied.push(`«${flat(c.from)}» → «${flat(c.to)}»`)
  }
  return { blocks: out, applied }
}

const textOf = (blocks: SanityBlock[]) =>
  blocks.map(b => (b.children ?? []).map(c => c.text ?? '').join('')).join(' ').replace(/\s+/g, ' ').trim()

/** The words did not change: only whitespace, and the blocks they sit in. */
export function sameText(before: SanityBlock[], after: SanityBlock[]): boolean {
  return textOf(before) === textOf(after)
}

/**
 * The blocks cut into sections: a title (H3) starts one, and so does each numbered item (an H4 that starts
 * with `1.`). The title's section runs up to the first item, so text before the list stays with it. An H4 with no
 * number, and every H5, belongs to the item above. A line of underscores or dashes starts one too: it
 * separates one document in the minutes from the next, and a heading right after it joins its section.
 * Everything before the first heading is one section, rules included: they are part of the cover. The levels are left alone: the editor checks the outline
 * across all sections of an entity, and cutting does not change it.
 */
export function cutSections(blocks: SanityBlock[]): SanityBlock[][] {
  const sections: SanityBlock[][] = []
  for (const b of blocks) {
    const text = (b.children ?? []).map(c => c.text ?? '').join('')
    const seenHeading = sections.some(sec => sec.some(x => x.style === 'h3' || x.style === 'h4'))
    const rule = seenHeading && RULE.test(text.trim())
    const startsSection = rule || b.style === 'h3' || (b.style === 'h4' && NUMBERED.test(text))
    const cur = sections[sections.length - 1]
    const afterRule = cur?.length === 1 && RULE.test((cur[0].children ?? []).map(c => c.text ?? '').join('').trim())
    if (!cur || (startsSection && !afterRule)) sections.push([b])
    else sections[sections.length - 1].push(b)
  }
  return sections
}

/**
 * `splitMinutes` then `cutSections`, with the two promises checked: the words are the same, and the headings
 * of all the sections together pass the save check. A description that cannot keep them comes back as the
 * reason, never as sections.
 */
export function restructureMinutes(blocks: SanityBlock[], seed: string): { sections: SanityBlock[][] } | { refused: string } {
  const after = splitMinutes(blocks, seed)
  if (!sameText(blocks, after)) return { refused: 'the words would change' }
  const sections = cutSections(after)
  const problems = checkContents(sections.map(s => JSON.stringify(s)))
  if (problems.length) return { refused: `${problems.length} heading(s) break the outline` }
  return { sections }
}
