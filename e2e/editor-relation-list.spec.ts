import { expect, test } from '@playwright/test'

// A long relation list is a scroll view of its first 10 rows (#393): the count is in the heading, the add button is
// below the scroll area, and the area expands to the whole list and collapses back.

type Page = import('@playwright/test').Page
// The page asks for the role texts (useRoles); the harness has no graph, so that is answered with no rows.
const open = async (page: Page, query = '') => {
  await page.route('**/api/neo4j/query', route => route.fulfill({ json: { rows: [] } }))
  await page.goto(`/e2e/harness/relation-list.html${query}`)
}
const scroller = (page: import('@playwright/test').Page) => page.locator('.list-scroll')
const rowNames = (page: import('@playwright/test').Page) => page.locator('.membership-unit-name')

/** Rows whose box lies inside the scroll area's visible box. */
async function visibleRows(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() => {
    const d = (globalThis as unknown as { document: { querySelector(s: string): { getBoundingClientRect(): { top: number; bottom: number } } | null; querySelectorAll(s: string): ArrayLike<{ getBoundingClientRect(): { top: number; bottom: number }; textContent: string | null }> } }).document
    const box = d.querySelector('.list-scroll')!.getBoundingClientRect()
    return Array.from(d.querySelectorAll('.membership-item'))
      .filter(li => { const r = li.getBoundingClientRect(); return r.top >= box.top - 1 && r.bottom <= box.bottom + 1 })
      .map(li => li.textContent ?? '')
  })
}

test('25 rows: the first 10 show in a scroll area, and the heading holds the count', async ({ page }) => {
  await open(page)
  await expect(page.getByRole('heading', { name: /Omtalte personer \(rediger\)/ })).toContainText('25')
  await expect(rowNames(page)).toHaveCount(25)
  const rows = await visibleRows(page)
  expect(rows).toHaveLength(10)
  expect(rows[0]).toContain('Person 01')
  expect(rows[9]).toContain('Person 10')
  const box = await scroller(page).evaluate(el => ({ scrolls: el.scrollHeight > el.clientHeight + 2, top: el.scrollTop }))
  expect(box).toEqual({ scrolls: true, top: 0 })
  // It is a keyboard-reachable region
  await expect(scroller(page)).toHaveAttribute('role', 'region')
  await expect(scroller(page)).toHaveAttribute('tabindex', '0')
})

test('the toggle is in the heading, and the add button is below the scroll area, not in it', async ({ page }) => {
  await open(page)
  const area = (await scroller(page).boundingBox())!
  const toggle = (await page.getByRole('button', { name: 'Vis alle 25' }).boundingBox())!
  const add = (await page.getByRole('button', { name: '+ Legg til person' }).boundingBox())!
  const heading = (await page.getByRole('heading', { name: /Omtalte personer/ }).boundingBox())!
  expect(toggle.y + toggle.height).toBeLessThanOrEqual(area.y + 1)       // above the list
  expect(Math.abs((toggle.y + toggle.height / 2) - (heading.y + heading.height / 2))).toBeLessThan(heading.height)   // on the heading's row
  expect(toggle.x).toBeGreaterThan(heading.x + heading.width / 2)        // at its right
  expect(add.y).toBeGreaterThanOrEqual(area.y + area.height - 1)         // below the list
})

test('the scroll area scrolls to the last row', async ({ page }) => {
  await open(page)
  await scroller(page).evaluate(el => { el.scrollTop = el.scrollHeight })
  const rows = await visibleRows(page)
  expect(rows.at(-1)).toContain('Person 25')
})

test('the toggle expands to the full list and collapses back', async ({ page }) => {
  await open(page)
  const toggle = page.getByRole('button', { name: 'Vis alle 25' })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  const less = page.getByRole('button', { name: 'Vis færre' })
  await expect(less).toHaveAttribute('aria-expanded', 'true')
  expect(await visibleRows(page)).toHaveLength(25)
  expect(await scroller(page).evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(2)
  await expect(scroller(page)).not.toHaveAttribute('role', 'region')
  await less.click()
  await expect(page.getByRole('button', { name: 'Vis alle 25' })).toHaveAttribute('aria-expanded', 'false')
  expect(await visibleRows(page)).toHaveLength(10)
})

test('10 rows or fewer look as before: no scroll area, no toggle', async ({ page }) => {
  await open(page, '?n=10')
  await expect(page.getByRole('heading', { name: /Omtalte personer/ })).toContainText('10')
  await expect(page.getByRole('button', { name: /^Vis (alle|færre)/ })).toHaveCount(0)
  expect(await scroller(page).evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(2)
  expect(await visibleRows(page)).toHaveLength(10)
})

test('opening a row shows the whole list, so what drops below the row is not cut off', async ({ page }) => {
  await open(page)
  await page.locator('.membership-summary').nth(2).click()
  await expect(page.getByRole('button', { name: 'Vis færre' })).toBeVisible()
  // the row's details (the person picker) are open, in a list that is no longer cut short
  await expect(page.locator('.membership-item.expanded .unit-picker')).toBeVisible()
  expect(await visibleRows(page)).toHaveLength(25)
})

test('adding a row shows the whole list with the new row in view', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: '+ Legg til person' }).click()
  await expect(rowNames(page)).toHaveCount(26)
  await expect(page.getByRole('button', { name: 'Vis færre' })).toBeVisible()
  await expect(page.locator('.membership-item').last()).toBeInViewport()
  await expect(page.getByRole('heading', { name: /Omtalte personer/ })).toContainText('26')
})

test('moving a row opens the whole list too', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Flytt Person 01' }).click()
  await expect(page.getByRole('button', { name: 'Vis færre' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Plassering for Person 01' })).toBeVisible()
})

test('there is room below the add button', async ({ page }) => {
  await open(page)
  const add = (await page.getByRole('button', { name: '+ Legg til person' }).boundingBox())!
  const main = (await page.locator('main').boundingBox())!
  // main has 16px of padding of its own: what is left is the list's margin
  expect(main.y + main.height - 16 - (add.y + add.height)).toBeGreaterThanOrEqual(40)
})
