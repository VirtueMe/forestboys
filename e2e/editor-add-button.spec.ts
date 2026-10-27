import { expect, test } from '@playwright/test'
import { openRecordedEditMode } from './helpers/replay.ts'
import { PAGES } from './pages.ts'

// The add button of a relation list sits under the list, not in the heading (#358): a new entry is added at the end,
// and the button Jan clicked is then still next to it instead of a page up.

const EDITABLE = PAGES.filter(t => t.edit !== false)

for (const target of EDITABLE) {
  test(`${target.kind} «${target.slug}»: every «+ Legg til» button comes after its list`, async ({ page }) => {
    await openRecordedEditMode(page, target)
    const sections = page.locator('section.edit-section').filter({ has: page.getByRole('button', { name: /^\+ / }) })
    const all = await sections.all()
    expect(all.length, 'the page has a relation list to check').toBeGreaterThan(0)
    for (const section of all) {
      const heading = await section.locator('h2').boundingBox()
      const button = await section.getByRole('button', { name: /^\+ / }).boundingBox()
      const entries = await section.locator('.membership-item, .edit-empty').all()
      expect(button!.y, 'the button is below the heading').toBeGreaterThan(heading!.y + heading!.height)
      for (const entry of entries) {
        const box = await entry.boundingBox()
        expect(button!.y, 'the button is below every entry').toBeGreaterThanOrEqual(box!.y + box!.height)
      }
    }
  })
}
