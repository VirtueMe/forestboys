import { expect, test } from '@playwright/test'
import { blocksOf, caretAtEndOf, openEditor } from './helpers/editor.ts'

// H3 is a button, H4 to H6 are in a list behind a small ▾ beside it (#127).
test.describe('the heading levels', () => {
  const more = (page: import('@playwright/test').Page) => page.getByRole('button', { name: 'Flere overskriftsnivåer' })
  const list = (page: import('@playwright/test').Page) => page.getByRole('group', { name: 'Overskriftsnivå' })
  const styleOfFirst = async (page: import('@playwright/test').Page) => (await blocksOf(page))[0].style

  for (const level of ['h4', 'h5', 'h6']) {
    test(`${level.toUpperCase()} is set from the list, and the list marks it and closes`, async ({ page }) => {
      await openEditor(page, 'paragraph')
      await caretAtEndOf(page, 'Første avsnitt.')
      await more(page).click()
      await list(page).getByRole('button', { name: level.toUpperCase() }).click()
      await expect(list(page)).toHaveCount(0)                                   // choosing closes the list
      await expect.poll(() => styleOfFirst(page)).toBe(level)

      await expect(more(page)).toHaveClass(/active/)                            // the ▾ lights up in H4 to H6
      await more(page).click()
      await expect(list(page).getByRole('button', { name: level.toUpperCase() })).toHaveAttribute('aria-pressed', 'true')
    })
  }

  test('choosing the level it already has turns the heading back into a paragraph', async ({ page }) => {
    await openEditor(page, 'paragraph')
    await caretAtEndOf(page, 'Første avsnitt.')
    await more(page).click()
    await list(page).getByRole('button', { name: 'H5' }).click()
    await expect.poll(() => styleOfFirst(page)).toBe('h5')
    await more(page).click()
    await list(page).getByRole('button', { name: 'H5' }).click()
    await expect.poll(() => styleOfFirst(page)).toBe('normal')
    await expect(more(page)).not.toHaveClass(/active/)
  })

  test('H3 and H4 to H6 replace one another, and the H3 button and the ▾ are one control', async ({ page }) => {
    await openEditor(page, 'paragraph')
    await caretAtEndOf(page, 'Første avsnitt.')
    await page.getByRole('button', { name: 'H3', exact: true }).click()
    await expect.poll(() => styleOfFirst(page)).toBe('h3')
    await more(page).click()
    await list(page).getByRole('button', { name: 'H4' }).click()
    await expect.poll(() => styleOfFirst(page)).toBe('h4')
    await page.getByRole('button', { name: 'H3', exact: true }).click()
    await expect.poll(() => styleOfFirst(page)).toBe('h3')

    // one control: both buttons sit in the same split group
    const split = page.locator('.pt-tb-split')
    await expect(split.getByRole('button', { name: 'H3', exact: true })).toBeVisible()
    await expect(split.getByRole('button', { name: 'Flere overskriftsnivåer' })).toBeVisible()
  })

  test('a click outside the list closes it', async ({ page }) => {
    await openEditor(page, 'paragraph')
    await caretAtEndOf(page, 'Første avsnitt.')
    await more(page).click()
    await expect(list(page)).toBeVisible()
    await page.locator('.pt-editable').click({ position: { x: 4, y: 4 } })
    await expect(list(page)).toHaveCount(0)
  })
})
