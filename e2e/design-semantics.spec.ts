import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { judgeAxe, type AxeException } from '../src/utils/axeFindings.ts'
import { openRecordedEditMode, openRecordedPage } from './helpers/replay.ts'
import { PAGES } from './pages.ts'

// Semantics of the real pages, judged by axe-core (#139): landmarks, names for buttons, links and fields,
// alt text, language, document title, ARIA use, target size. WCAG 2.0 to 2.2 level A and AA, and axe's
// best-practice rules. Not contrast: that is judged by our own check (design-checks.spec.ts), which knows the
// decorative-glyph rule and is the source for it, and two judges of one thing would only disagree.

/**
 * What has been decided about a finding. An exception names its page kinds, the elements, and the issue that
 * holds the decision, and it expires by itself: if it matches nothing on a page it names, the test fails and
 * says to delete it (src/utils/axeFindings.ts).
 */
const EXCEPTIONS: AxeException[] = [
  {
    rule: 'target-size',
    pages: ['events'],
    selectors: ['.tl-dot', '.tl-bubble'],
    issue: '#142',
    reason: 'the timeline markers are small by design, and the list of events below does the same job; to be decided',
  },
]

/** The development tooling Vite and Vue add to every page: not the app, and not judged. */
const TOOLING = '[id*="vue-devtools"], [class*="vue-devtools"], vite-error-overlay'

/** One page, judged by axe: what is left over once the decided exceptions are taken away. */
async function judgePage(page: import('@playwright/test').Page, kind: string, info: import('@playwright/test').TestInfo) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .disableRules(['color-contrast'])
    .exclude(TOOLING)
    .analyze()

  const judged = judgeAxe(kind, results.violations, EXCEPTIONS)

  // What was not a clean pass stays on the record, in the report.
  for (const e of judged.excepted) info.annotations.push({ type: 'excepted', description: e })
  for (const i of results.incomplete) info.annotations.push({ type: 'needs review', description: `${i.id}: ${i.help} (${i.nodes.length})` })
  info.annotations.push({ type: 'checked', description: `${results.passes.length} rules passed` })

  expect(judged.problems).toEqual([])
  // axe ran: a page that was never looked at must not pass for having nothing to fail.
  expect(results.passes.length).toBeGreaterThan(10)
}

for (const target of PAGES) {
  test(`${target.kind} «${target.slug}»: no accessibility finding that nobody has decided about`, async ({ page }, info) => {
    await openRecordedPage(page, target)
    await judgePage(page, target.kind, info)
  })
}

// The same in the edit mode an admin sees (#146).
for (const target of PAGES.filter(t => t.edit !== false)) {
  test(`${target.kind} «${target.slug}»: no accessibility finding that nobody has decided about, in edit mode`, async ({ page }, info) => {
    await openRecordedEditMode(page, target)
    await judgePage(page, target.kind, info)
  })
}
