import { expect, test } from '@playwright/test'
import { openRecordedEditMode, replayPage } from './helpers/replay.ts'
import { PAGES } from './pages.ts'

// The recorded pages render from their recordings alone (#139). If these fail, the design checks on the pages
// are checking a page that did not render.
test.describe('the recorded pages', () => {
  for (const target of PAGES) {
    test(`${target.kind} «${target.slug}» renders from its recording, with nothing missing`, async ({ page }) => {
      const replay = await replayPage(page, target)
      await page.goto(target.path)
      await expect(page.locator('h1').first()).toContainText(target.title)
      await page.waitForLoadState('networkidle')
      expect(replay.misses()).toEqual([])
    })
  }

  // Edit mode asks for more (the lists its pickers offer): the recording holds them too (#140).
  for (const target of PAGES.filter(t => t.edit !== false)) {
    test(`${target.kind} «${target.slug}» renders in edit mode from its recording, with nothing missing`, async ({ page }) => {
      const replay = await openRecordedEditMode(page, target)
      expect(replay.misses()).toEqual([])
    })
  }

  test('say which query is missing when a page asks for something that was not recorded', async ({ page }) => {
    const [first, second] = PAGES
    const replay = await replayPage(page, first)          // the recording of one page ...
    await page.goto(second.path)                          // ... answering another
    await page.waitForLoadState('networkidle')
    const misses = replay.misses()
    expect(misses.length).toBeGreaterThan(0)
    expect(misses.some(m => m.startsWith('neo4j: MATCH'))).toBe(true)     // names the query, to record it again
  })
})
