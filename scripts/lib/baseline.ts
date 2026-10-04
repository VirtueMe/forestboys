/**
 * The baseline export a sync compares Sanity against for a document that has
 * no stamp yet (docs/SANITY-SYNC.md, "Baseline"). It is a local file under
 * data/ (gitignored, tens of MB): the dev machine has it, CI does not — and
 * must not need it. A document's stamps on the node are the baseline once it
 * is stamped, so a missing file only means "no file baseline": a field with no
 * stamp then has no baseline at all and goes to review, never to an automatic
 * apply. (#80)
 */

import { existsSync, readFileSync } from 'node:fs'
import type { Doc } from './person-sync.ts'

/** The documents of a baseline export by _id, or an empty map — with a note — when the file is not there. */
export function loadBaselineFile(path: string): Map<string, Doc> {
  if (!existsSync(path)) {
    console.error(`No baseline file (${path}): a field with no stamp on the node has no baseline and goes to review.`)
    return new Map()
  }
  return new Map((JSON.parse(readFileSync(path, 'utf8')) as Doc[]).map(d => [d._id, d]))
}
