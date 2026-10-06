/**
 * Verifies DESIGN.md and DESIGN-dark.md (#134), with the tools of the format's own repo:
 * `@google/design.md` (google-labs-code/design.md). Its linter reads the front matter and checks
 * structure, references and the contrast of every `components` pair against WCAG AA (4.5:1).
 * The two files declare the pairs the design uses as `components`, so the pair list is data.
 *
 * What is ours on top of the linter:
 *  - The linter only warns and its exit code is 0, so a failing pair would pass unseen. Here a pair
 *    below AA fails. The documents are a promise: a redesign may change the look as it likes as long
 *    as every declared pair keeps meeting AA. There is no list of tolerated failures.
 *  - A drift check that the colours in the documents are the colours in src/assets/main.css.
 *
 * `npx tsx scripts/design/check.ts` prints the report and exits 1 on a problem. The pure functions
 * are used by check.test.ts, so `npm test` runs the same check.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { lint } from '@google/design.md/linter'

const ROOT = join(import.meta.dirname, '..', '..')

export type Theme = 'light' | 'dark'

export const DESIGN_FILES: { theme: Theme; file: string }[] = [
  { theme: 'light', file: 'DESIGN.md' },
  { theme: 'dark',  file: 'DESIGN-dark.md' },
]

/** Rules the linter reports that are not failures here, and why. */
const NOTES_ONLY = new Set(['token-summary', 'orphaned-tokens', 'token-like-ignored'])

export interface Verdict {
  /** What fails the check. */
  problems: string[]
  /** Everything else the linter said, for the report. */
  notes: string[]
  /** The colours the document defines, as hex. */
  colors: Record<string, string>
}

/** Lint one document and judge the findings. */
export function checkDesign(theme: Theme, markdown: string): Verdict {
  const report = lint(markdown)
  const problems: string[] = []
  const notes: string[] = []

  for (const f of report.findings) {
    const where = f.path ? ` ${f.path}` : ''
    if (f.severity === 'error' || f.rule === 'broken-ref') {
      problems.push(`${f.rule ?? 'error'}${where}: ${f.message}`)
    } else if (f.rule === 'contrast-ratio') {
      problems.push(`${theme}:${(f.path ?? '').replace(/^components\./, '')} is below WCAG AA: ${f.message}`)
    } else if (f.rule && NOTES_ONLY.has(f.rule)) {
      notes.push(`${f.rule}${where}: ${f.message}`)
    } else {
      // Anything else the linter says (a warning on structure, say) is reported, and not hidden.
      notes.push(`${f.severity} ${f.rule ?? ''}${where}: ${f.message}`)
    }
  }
  const colors: Record<string, string> = {}
  for (const [name, c] of report.designSystem.colors) colors[name] = (c as { hex: string }).hex.toUpperCase()
  return { problems, notes, colors }
}

/** The hex custom properties of src/assets/main.css: light in `:root`, dark in the dark media block. */
export function cssColors(css: string): Record<Theme, Record<string, string>> {
  const hex = (block: string) =>
    Object.fromEntries([...block.matchAll(/--([a-z-]+):\s*(#[0-9A-Fa-f]{6})\b/g)].map(m => [m[1], m[2].toUpperCase()]))
  const light = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1]
  const dark  = /prefers-color-scheme:\s*dark\)\s*\{\s*:root[^{]*\{([\s\S]*?)\n\s*\}/.exec(css)?.[1]
  if (!light || !dark) throw new Error('main.css: could not find the light :root block and the dark media block')
  return { light: hex(light), dark: hex(dark) }
}

/**
 * Where a document and the CSS disagree. `primary` is the spec's name for the accent and is the
 * same value as `faded-red` by design (like `danger`), so it is compared with that, not with a variable.
 */
export function colorDrift(doc: Record<string, string>, css: Record<string, string>): string[] {
  const out: string[] = []
  for (const [name, value] of Object.entries(doc)) {
    if (name === 'primary') {
      if (value !== doc['faded-red']) out.push(`primary is ${value} but faded-red is ${doc['faded-red']}`)
      continue
    }
    if (!(name in css)) out.push(`${name} (${value}) is in the document, not in main.css`)
    else if (css[name] !== value) out.push(`${name}: document ${value}, main.css ${css[name]}`)
  }
  for (const name of Object.keys(css)) if (!(name in doc)) out.push(`${name} (${css[name]}) is in main.css, not in the document`)
  return out
}

/** Everything, over the real files. */
export function checkAll(root = ROOT) {
  const css = cssColors(readFileSync(join(root, 'src/assets/main.css'), 'utf8'))
  return DESIGN_FILES.map(({ theme, file }) => {
    const verdict = checkDesign(theme, readFileSync(join(root, file), 'utf8'))
    const drift = colorDrift(verdict.colors, css[theme])
    return { theme, file, notes: verdict.notes, problems: [...verdict.problems, ...drift.map(d => `drift: ${d}`)] }
  })
}

// `npx tsx scripts/design/check.ts`
if (import.meta.filename === process.argv[1]) {
  let failed = 0
  for (const r of checkAll()) {
    console.log(`\n${r.file} (${r.theme})`)
    for (const n of r.notes) console.log(`  · ${n}`)
    for (const p of r.problems) { console.log(`  ✗ ${p}`); failed++ }
    if (!r.problems.length) console.log('  ✓ no problems')
  }
  console.log(failed ? `\n${failed} problem(s)` : '\nDesign documents check out.')
  process.exit(failed ? 1 : 0)
}
