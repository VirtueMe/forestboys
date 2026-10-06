import { expect, test } from '@playwright/test'

// The whole chain in one line: the runner, the dev server and the browser. If this fails, nothing
// else in e2e/ means anything.
test('the app starts and serves its page', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('Milorg 2 Utforsker')
})
