import { devices, expect, test } from '@playwright/test'
import { openRecordedEditMode } from './helpers/replay.ts'
import { PAGES } from './pages.ts'

// A page in edit mode has one scrollbar. Most pages scroll in a box of their own, and the shell's
// `main.page-content` scrolls too if anything escapes that box, e.g. an absolutely positioned hidden input
// with no positioned ancestor inside it (#441). The events view has it the other way round: the shell scrolls
// and its panels do not. So the rule is on the pair, not on either one.
const SCROLLERS = 'main.page-content, .detail-page, .events-page .panels'
const SIZES = { desktop: devices['Desktop Chrome'].viewport, phone: devices['Pixel 7'].viewport }

for (const [size, viewport] of Object.entries(SIZES)) {
  test.describe(`edit mode has one scrollbar, ${size}`, () => {
    test.use({ viewport })
    for (const target of PAGES.filter(t => t.edit !== false)) {
      test(`${target.kind} «${target.slug}»`, async ({ page }) => {
        await openRecordedEditMode(page, target)
        const scrolling = await page.locator(SCROLLERS).evaluateAll(els =>
          els.filter(el => el.scrollHeight > el.clientHeight).map(el => el.className))
        expect(scrolling).toHaveLength(1)
      })
    }
  })
}
