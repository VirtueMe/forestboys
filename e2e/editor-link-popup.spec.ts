import { expect, test } from '@playwright/test'
import { openEditor } from './helpers/editor.ts'

// The link popup (#123): it hangs from the toolbar, so at a narrow width it is never wider than the
// toolbar and never past its edge.
test.describe('the link popup at a narrow width', () => {
  test.use({ viewport: { width: 375, height: 700 } })

  test('opens inside the toolbar and inside the window, not clipped', async ({ page }) => {
    await openEditor(page, 'links')
    await page.locator('.pt-editable').getByText('det første møtet').click()
    await page.getByRole('button', { name: 'Lenke' }).click()

    const pop = page.locator('.pt-link-pop')
    await expect(pop).toBeVisible()
    const [popBox, barBox] = [await pop.boundingBox(), await page.locator('.pt-toolbar').boundingBox()]
    expect(popBox && barBox).toBeTruthy()
    expect(popBox!.x).toBeGreaterThanOrEqual(barBox!.x - 0.5)
    expect(popBox!.x + popBox!.width).toBeLessThanOrEqual(barBox!.x + barBox!.width + 0.5)
    expect(popBox!.x + popBox!.width).toBeLessThanOrEqual(375)
    await expect(pop).toBeInViewport({ ratio: 1 })
  })
})
