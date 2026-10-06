/**
 * The words of a link, for the link popup's «Tekst» field (PortableTextEditorReact).
 *
 * From a link, or from a selection inside one block, to the text, the range the editor
 * should replace, and whether replacing it is safe. Replacing words inside a span keeps the
 * span's marks; when the words sit in spans with different marks (part bold, part not) the
 * new text could only take one of them, so the field is read-only rather than lose
 * formatting silently. Pure: the caller passes the block as the editor holds it.
 */

import type { SanityBlock } from './portableText.ts'

export interface TextRange {
  /** The span the words start in, and the offset in it. */
  startKey:    string
  startOffset: number
  /** The span the words end in, and the offset in it. */
  endKey:      string
  endOffset:   number
  /** The words. */
  text:        string
  /** The marks every span of the words carries (decorators and annotation keys). */
  marks:       string[]
  /** False when the words carry different marks: replacing them would lose formatting. */
  editable:    boolean
}

export interface SpanPoint { spanKey: string; offset: number }

const sameMarks = (a: string[] = [], b: string[] = []) =>
  a.length === b.length && a.every(m => b.includes(m))

/** The words of one span-run: `parts` are the non-empty pieces, in order. */
function toRange(parts: { key: string; from: number; to: number; text: string; marks: string[] }[]): TextRange | null {
  if (parts.length === 0) return null
  const first = parts[0]
  const last  = parts[parts.length - 1]
  return {
    startKey:    first.key,
    startOffset: first.from,
    endKey:      last.key,
    endOffset:   last.to,
    text:        parts.map(p => p.text).join(''),
    marks:       first.marks,
    editable:    parts.every(p => sameMarks(p.marks, first.marks)),
  }
}

/** The words a link covers in its block: every span that carries the mark. */
export function linkTextRange(block: SanityBlock, markKey: string): TextRange | null {
  const parts = (block.children ?? [])
    .filter(c => c._type === 'span' && (c.marks ?? []).includes(markKey) && c.text.length > 0)
    .map(c => ({ key: c._key, from: 0, to: c.text.length, text: c.text, marks: c.marks ?? [] }))
  return toRange(parts)
}

/** The words between two points in one block, either way round. Null when empty. */
export function selectionTextRange(block: SanityBlock, a: SpanPoint, b: SpanPoint): TextRange | null {
  const spans = (block.children ?? []).filter(c => c._type === 'span')
  const ia = spans.findIndex(c => c._key === a.spanKey)
  const ib = spans.findIndex(c => c._key === b.spanKey)
  if (ia < 0 || ib < 0) return null
  const [start, end] = ia < ib || (ia === ib && a.offset <= b.offset) ? [a, b] : [b, a]
  const i0 = Math.min(ia, ib)
  const i1 = Math.max(ia, ib)
  const parts = []
  for (let i = i0; i <= i1; i++) {
    const s    = spans[i]
    const from = i === i0 ? start.offset : 0
    const to   = i === i1 ? end.offset   : s.text.length
    if (to > from) parts.push({ key: s._key, from, to, text: s.text.slice(from, to), marks: s.marks ?? [] })
  }
  return toRange(parts)
}

/**
 * The marks of some words as `insert.span` takes them: the decorators, and the annotations
 * with their values (a mark that names a `markDef`). Typing new words would not carry a link
 * or a person mark along, so they are put back explicitly.
 */
export function splitMarks(block: SanityBlock, marks: string[]) {
  const defs = block.markDefs ?? []
  const decorators:  string[] = []
  const annotations: { name: string; value: Record<string, unknown>; key: string }[] = []
  for (const m of marks) {
    const def = defs.find(d => d._key === m)
    if (!def) { decorators.push(m); continue }
    const { _key, _type, ...value } = def
    annotations.push({ name: _type, value, key: _key })
  }
  return { decorators, annotations }
}
