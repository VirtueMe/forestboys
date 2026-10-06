/**
 * The save validator for headings in descriptions (#127).
 *
 * A description sits under the page's own section heading, so a heading in it must fit below that
 * one (src/utils/headingOutline.ts: no empty heading, none shallower than the section's children,
 * none more than one level deeper than the one before). A save that breaks the rules is refused
 * (422) with the headings and the reason. Nothing is rewritten here: the editor offers the repair
 * and the user saves again.
 *
 * Unlike the link guard this needs no database, and it judges the whole description, not what the
 * save adds: the editor offers «Rett opp alle», so an old description is one click from valid.
 */

import { checkContents, HEADINGS_REFUSED, headingMessage, type OutlineOptions } from '../../src/utils/headingOutline.ts'

/** A ready 422 response when the sections break the outline, else null. Sections are read in `order`. */
export function guardHeadings(
  sections: { order: number; content: string }[],
  options?: OutlineOptions,
): Response | null {
  const contents = [...sections].sort((a, b) => a.order - b.order).map(s => s.content)
  const problems = checkContents(contents, options)
  if (!problems.length) return null
  return new Response(JSON.stringify({
    error: HEADINGS_REFUSED,
    headings: problems.map(p => ({ ...p, message: headingMessage(p, options) })),
  }), { status: 422, headers: { 'Content-Type': 'application/json' } })
}
