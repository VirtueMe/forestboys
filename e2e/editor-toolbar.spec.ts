import { expect, test } from '@playwright/test'
import { caretAtEndOf, openEditor, reportedTexts } from './helpers/editor.ts'

// The toolbar and the full-window mode (#123).
test.describe('the toolbar and the box', () => {
  test('the text scrolls inside its box, so the toolbar stays in view', async ({ page }) => {
    await openEditor(page, 'long')
    const box = page.locator('.pt-editable')
    const { scrollable, scrollY } = await box.evaluate(el => ({
      scrollable: el.scrollHeight > el.clientHeight,
      scrollY: (globalThis as unknown as { scrollY: number }).scrollY,
    }))
    expect(scrollable).toBe(true)

    await box.evaluate(el => { el.scrollTop = el.scrollHeight })
    await expect(page.locator('.pt-toolbar')).toBeInViewport({ ratio: 1 })
    expect(await page.evaluate(() => (globalThis as unknown as { scrollY: number }).scrollY)).toBe(scrollY)
  })

  test('a short text keeps a box of at least 200px, a long one at most 60% of the window', async ({ page }) => {
    await openEditor(page, 'empty')
    expect((await page.locator('.pt-editable').boundingBox())?.height).toBeGreaterThanOrEqual(200)

    await openEditor(page, 'long')
    const height = (await page.locator('.pt-editable').boundingBox())?.height ?? 0
    expect(height).toBeLessThanOrEqual((page.viewportSize()?.height ?? 0) * 0.6 + 1)
  })
})

test.describe('the full window', () => {
  const host = (page: import('@playwright/test').Page) => page.locator('.pt-editor-host--full')

  test('Utvid fills the window, and what is typed there is in the value', async ({ page }) => {
    await openEditor(page, 'paragraph')
    await page.getByRole('button', { name: 'Utvid' }).click()
    await expect(host(page)).toBeVisible()
    const view = page.viewportSize()!
    expect(await host(page).boundingBox()).toMatchObject({ x: 0, y: 0, width: view.width, height: view.height })

    await caretAtEndOf(page, 'Første avsnitt.')
    await page.keyboard.type(' I fullt vindu.')
    await expect.poll(() => reportedTexts(page)).toEqual(['Første avsnitt. I fullt vindu.'])
  })

  test('Esc and «Ferdig» both close it, and the text stays', async ({ page }) => {
    await openEditor(page, 'paragraph')
    await page.getByRole('button', { name: 'Utvid' }).click()
    await expect(host(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(host(page)).toHaveCount(0)

    await page.getByRole('button', { name: 'Utvid' }).click()
    await expect(host(page)).toBeVisible()
    await page.getByRole('button', { name: 'Ferdig' }).click()
    await expect(host(page)).toHaveCount(0)
    await expect(page.locator('.pt-editable')).toContainText('Første avsnitt.')
  })

  test('Esc closes the link box first and only then the window', async ({ page }) => {
    await openEditor(page, 'paragraph')
    await page.getByRole('button', { name: 'Utvid' }).click()
    await caretAtEndOf(page, 'Første avsnitt.')
    await page.getByRole('button', { name: 'Lenke' }).click()
    await expect(page.locator('.pt-link-pop')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.locator('.pt-link-pop')).toHaveCount(0)
    await expect(host(page)).toBeVisible()          // the window is still open

    await page.locator('.pt-editable').click()      // the key goes to the page again, not to the closed box
    await page.keyboard.press('Escape')
    await expect(host(page)).toHaveCount(0)
  })

  test('Esc closes the heading list first and only then the window (#127)', async ({ page }) => {
    await openEditor(page, 'paragraph')
    await page.getByRole('button', { name: 'Utvid' }).click()
    await caretAtEndOf(page, 'Første avsnitt.')
    await page.getByRole('button', { name: 'Flere overskriftsnivåer' }).click()
    await expect(page.getByRole('group', { name: 'Overskriftsnivå' })).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('group', { name: 'Overskriftsnivå' })).toHaveCount(0)
    await expect(host(page)).toBeVisible()
  })
})
