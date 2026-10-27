import { expect, test } from '@playwright/test'
import { openRecordedEditMode } from './helpers/replay.ts'
import { PAGES } from './pages.ts'

// The people of an event are moved from a panel on the row (#355): a position box that is checked, and the steps
// up, down, to the top and to the bottom. The order is what is saved.

const EVENT = PAGES.find(t => t.kind === 'event')!

test('the people of an event move from a panel, and the page asks to save', async ({ page }) => {
  await openRecordedEditMode(page, EVENT)
  const list = page.locator('section.edit-section').filter({ has: page.getByRole('button', { name: /^Flytt / }).first() })
  const names = () => list.locator('.membership-unit-name').allTextContents()
  const saveBar = page.getByText('Ser det bra ut?')

  const before = await names()
  const last = before.length
  expect(last, 'the recorded event has at least two people').toBeGreaterThan(1)
  await expect(saveBar).toHaveCount(0)

  // One panel at a time, and it follows its person when the person moves.
  await list.getByRole('button', { name: `Flytt ${before[0]}`, exact: true }).click()
  const panel = list.getByRole('group', { name: `Plassering for ${before[0]}` })
  const position = panel.getByRole('textbox', { name: 'Plassering' })
  await expect(position).toHaveValue('1')
  await expect(position).toBeFocused()
  await expect(panel.getByRole('button', { name: 'Opp', exact: true })).toBeDisabled()
  await expect(panel.getByRole('button', { name: 'Til toppen' })).toBeDisabled()

  await panel.getByRole('button', { name: 'Ned', exact: true }).click()
  expect(await names()).toEqual([before[1], before[0], ...before.slice(2)])
  await expect(position).toHaveValue('2')
  await expect(saveBar).toBeVisible()

  // A position is typed, checked, and applied with Enter.
  await position.fill('0')
  await expect(panel.getByRole('alert')).toHaveText(`Velg en plass fra 1 til ${last}.`)
  await expect(panel.getByRole('button', { name: 'Flytt til valgt plass' })).toBeDisabled()
  await position.fill(String(last + 1))
  await expect(panel.getByRole('alert')).toBeVisible()
  await position.fill('x')
  await expect(panel.getByRole('alert')).toHaveText('Skriv et tall.')
  await position.fill('2')
  await expect(panel.getByRole('button', { name: 'Flytt til valgt plass' })).toBeDisabled()   // already there
  await position.fill('1')
  await expect(panel.getByRole('button', { name: 'Flytt til valgt plass' })).toBeEnabled()
  await panel.getByRole('button', { name: 'Flytt til valgt plass' }).click()
  expect(await names()).toEqual(before)
  await expect(saveBar).toHaveCount(0)
  await position.fill('2')
  await position.press('Enter')                                                                      // Enter applies too
  expect(await names()).toEqual([before[1], before[0], ...before.slice(2)])
  await panel.getByRole('button', { name: 'Til toppen' }).click()
  expect(await names()).toEqual(before)

  // The ends.
  await panel.getByRole('button', { name: 'Til bunnen' }).click()
  expect((await names()).at(-1)).toBe(before[0])
  await expect(position).toHaveValue(String(last))
  await expect(panel.getByRole('button', { name: 'Ned', exact: true })).toBeDisabled()
  await panel.getByRole('button', { name: 'Til toppen' }).click()
  expect(await names()).toEqual(before)

  // Escape and a click outside close it.
  await position.press('Escape')
  await expect(panel).toHaveCount(0)
  await list.getByRole('button', { name: `Flytt ${before[1]}`, exact: true }).click()
  await expect(list.getByRole('group')).toHaveCount(1)
  await page.locator('h2').first().click()
  await expect(list.getByRole('group')).toHaveCount(0)
})

// The arrow is the last thing in the row, after «Flytt», and opens and closes the row like the name does.
test('the arrow after «Flytt» opens and closes the row', async ({ page }) => {
  await openRecordedEditMode(page, EVENT)
  const row = page.locator('.membership-item').filter({ has: page.getByRole('button', { name: /^Flytt / }) }).first()
  const summary = row.locator('.membership-summary')
  const arrow = row.locator('.membership-chevron')
  const move = row.getByRole('button', { name: /^Flytt / })

  expect((await arrow.boundingBox())!.x, 'the arrow is right of «Flytt»').toBeGreaterThan((await move.boundingBox())!.x)
  await expect(summary).toHaveAttribute('aria-expanded', 'false')
  await arrow.click()
  await expect(summary).toHaveAttribute('aria-expanded', 'true')
  await arrow.click()
  await expect(summary).toHaveAttribute('aria-expanded', 'false')
})
