import { expect, test, type Page } from '@playwright/test'
import { openRecordedEditMode, openRecordedPage } from './helpers/replay.ts'
import { PAGES } from './pages.ts'

// The full window of the description editor (#123) is as wide as the section the description is read in, not narrower (#332):
// the content width less the section's own padding, about 1288 px, in page px at every zoom, and the whole window less the
// gutter when the window is narrower than that. Expanding never makes the editor narrower than it was in the page.

const person = PAGES.find(p => p.kind === 'person')!

/** The width of a description as it is read on the page (the preview), in page px: `offsetWidth` ignores the page's zoom. */
async function previewWidth(page: Page) {
  await openRecordedPage(page, person)
  return page.evaluate(() => (document.querySelector('.portable-text') as HTMLElement).closest<HTMLElement>('.section-wrap')!.offsetWidth)
}

/** The editor's width in the page and after Utvid, and the window, all in page px. */
async function editorWidths(page: Page) {
  await openRecordedEditMode(page, person)
  const read = () => page.evaluate(() => ({
    editable: (document.querySelector('.pt-editor-host .pt-editable') as HTMLElement).offsetWidth,
    window: window.innerWidth / (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--page-zoom')) || 1),
  }))
  const inline = await read()
  await page.getByRole('button', { name: 'Utvid', exact: true }).click()
  await expect(page.locator('.pt-editor-host--full')).toHaveCount(1)
  await page.waitForTimeout(200)
  return { inline, full: await read() }
}

for (const [width, label] of [[390, 'a phone'], [1000, 'a narrow window'], [1440, 'a desktop window'], [1920, 'zoom 1.25'], [2560, 'zoom 1.5']] as const) {
  test(`${label} (${width}px): the full window is as wide as the section, or the window less the gutter`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    const section = await previewWidth(page)
    const { inline, full } = await editorWidths(page)

    // The cap is the content width less the section's padding on both sides; a narrower window is filled, less 12 px a side.
    const cap = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement)
      return parseFloat(css.getPropertyValue('--content-max-width')) - 2 * parseFloat(css.getPropertyValue('--space-md'))
    })
    expect(Math.abs(full.editable - Math.min(cap, full.window - 24))).toBeLessThanOrEqual(1)
    expect(full.editable).toBeGreaterThanOrEqual(inline.editable - 1)       // expanding never makes it narrower
    // Wide windows: exactly the section (the page is capped at 1320 px, so the section is 1288), not 960.
    if (width >= 1440) {
      expect(Math.abs(full.editable - section)).toBeLessThanOrEqual(1)
      expect(full.editable).toBeGreaterThan(1280)
    }
  })
}
