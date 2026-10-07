import { expect, test } from '@playwright/test'
import { judgeText, type Violation } from '../src/utils/contrast.ts'
import { checkPageOutline } from '../src/utils/pageOutline.ts'
import { collectHeadings, collectTextSamples } from './helpers/collect.ts'
import { openRecordedEditMode, openRecordedPage } from './helpers/replay.ts'
import { PAGES } from './pages.ts'

// The design checks on the real pages (#139), rendered from their recordings. They judge what the page
// draws, not what a document declares: `npm run check:design` (#134) checks the declared pairs, and this finds
// a token used where nobody declared the pair, a heading level that was skipped, and the like.

const line = (v: Violation) =>
  `${v.ratio}:1, needs ${v.required}: ${v.fg} on ${v.bg}, ${v.fontSize}px/${v.fontWeight}, ${v.count}x, for example ${v.examples.join('; ')}`

for (const theme of ['light', 'dark'] as const) {
  test.describe(`contrast, ${theme} theme`, () => {
    test.use({ colorScheme: theme })

    for (const target of PAGES) {
      test(`${target.kind} «${target.slug}»: all text meets WCAG AA`, async ({ page }, info) => {
        await openRecordedPage(page, target)
        const judged = judgeText(await collectTextSamples(page))

        // What was not a pass is on the record, so it is visible in the report and cannot hide.
        for (const n of judged.notJudged) info.annotations.push({ type: 'not judged', description: `${n.count}: ${n.reason}, for example ${n.examples[0]}` })
        info.annotations.push({ type: 'checked', description: `${judged.passed} passed, ${judged.decorative} decorative` })

        expect(judged.violations.map(line)).toEqual([])
        // Something was judged: a page that rendered nothing must not pass by having nothing to fail.
        expect(judged.passed).toBeGreaterThan(10)
      })
    }
  })
}

// The same, in the edit mode an admin sees (#146): the placeholders, the editor and the forms are only there.
for (const theme of ['light', 'dark'] as const) {
  test.describe(`contrast in edit mode, ${theme} theme`, () => {
    test.use({ colorScheme: theme })

    for (const target of PAGES.filter(t => t.edit !== false)) {
      test(`${target.kind} «${target.slug}»: all text meets WCAG AA`, async ({ page }, info) => {
        await openRecordedEditMode(page, target)
        const judged = judgeText(await collectTextSamples(page))

        for (const n of judged.notJudged) info.annotations.push({ type: 'not judged', description: `${n.count}: ${n.reason}, for example ${n.examples[0]}` })
        info.annotations.push({ type: 'checked', description: `${judged.passed} passed, ${judged.decorative} decorative` })

        expect(judged.violations.map(line)).toEqual([])
        expect(judged.passed).toBeGreaterThan(10)
      })
    }
  })
}

test.describe('the heading outline', () => {
  for (const target of PAGES) {
    test(`${target.kind} «${target.slug}»: one h1, and no skipped level`, async ({ page }) => {
      await openRecordedPage(page, target)
      const headings = await collectHeadings(page)
      expect(checkPageOutline(headings).map(p => p.message)).toEqual([])
      expect(headings.length).toBeGreaterThanOrEqual(target.minHeadings ?? 2)   // it rendered more than a title
    })
  }
})

// The same outline in the edit mode an admin sees (#140): the page is opened with `/auth/me` answered as an
// admin and «Rediger» chosen. Only what is visible counts, and in edit mode that is the edit pane, not the preview.
test.describe('the heading outline in edit mode', () => {
  for (const target of PAGES.filter(t => t.edit !== false)) {
    test(`${target.kind} «${target.slug}»: one h1, and no skipped level`, async ({ page }) => {
      await openRecordedEditMode(page, target)
      const headings = await collectHeadings(page)
      expect(checkPageOutline(headings).map(p => p.message)).toEqual([])
      expect(headings.length).toBeGreaterThanOrEqual(target.minHeadings ?? 2)
    })
  }
})
