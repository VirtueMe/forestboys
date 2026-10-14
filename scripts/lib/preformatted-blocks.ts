/**
 * The blocks the renderer used to draw as a table by looking for tabs (`isTableBlock`, #256), found
 * again so that the editor's own style can be set on them (#260).
 *
 * The rule is the renderer's own as it was on the day the renderer stopped deciding (it is gone from there
 * now), and it must not change: it decided how production looked, and it is what the sync uses to mark
 * the tables in what Sanity gives. A block is a table row when it has a tab, unless it also carries
 * prose: a line longer than PROSE_LINE_MIN with no tab and no column padding.
 */

import type { SanityBlock } from '../../src/utils/portableText.ts'

const PROSE_LINE_MIN = 100
const COLUMN_PADDING = / {3,}/

const textOf = (b: SanityBlock) => (b.children ?? []).map(c => c.text ?? '').join('')

/** Drawn as a table by the old rule: an ordinary paragraph (not a list item, heading or quote) with the tabs and no prose. */
export function wasDrawnAsTable(b: SanityBlock): boolean {
  if (b._type !== 'block' || b.listItem) return false
  if (b.style && b.style !== 'normal') return false
  const text = textOf(b)
  if (!text.includes('\t')) return false
  return !text.split('\n').some(line => line.length > PROSE_LINE_MIN && !line.includes('\t') && !COLUMN_PADDING.test(line))
}

/**
 * What a sync or an import takes in from Sanity, which has no `preformatted` style: the table blocks
 * marked, so that what the graph holds after the migration is what an import would make of Sanity's text,
 * and a sync does not read it as an edit to rewrite. Not a block list (null, a string) comes back as it was.
 */
export function preformattedFromSanity<T>(blocks: T): T {
  return (Array.isArray(blocks) ? markPreformatted(blocks as SanityBlock[]).blocks : blocks) as T
}

/** The blocks with `preformatted` set on every one the old rule drew as a table; the count says how many. Nothing else changes. */
export function markPreformatted(blocks: SanityBlock[]): { blocks: SanityBlock[]; marked: number } {
  let marked = 0
  const out = blocks.map(b => {
    if (!wasDrawnAsTable(b)) return b
    marked++
    return { ...b, style: 'preformatted' }
  })
  return { blocks: out, marked }
}
