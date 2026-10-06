import { expect, type Page } from '@playwright/test'
import type { Block, Harness } from '../harness/types.ts'

type WithHarness = { __harness: Harness }

/** Open the harness with a named fixture (e2e/harness/fixtures.ts) and wait for the editor to be there. */
export async function openEditor(page: Page, fixture = 'empty') {
  await page.goto(`/e2e/harness/editor.html?fixture=${fixture}`)
  await expect(page.locator('.pt-editable')).toBeVisible()
}

/** What the editor has reported so far (or the fixture, before it has). */
export const blocksOf = (page: Page) => page.evaluate(() => (globalThis as unknown as WithHarness).__harness.value())

/** How many times the editor has reported a change. */
export const reportsOf = (page: Page) => page.evaluate(() => (globalThis as unknown as WithHarness).__harness.reports())

/** Replace the content from outside, as a repair or «Angre» does. */
export const setFromOutside = (page: Page, blocks: Block[]) =>
  page.evaluate(b => { (globalThis as unknown as WithHarness).__harness.set(b) }, blocks)

/** The text of each block, for assertions that do not care about keys. */
export const texts = (blocks: Block[]) => blocks.map(b => (b.children ?? []).map(c => c.text).join(''))

/**
 * The text of each block as the editor last reported it. Poll it, so a failure shows what was expected
 * and what was there, and so the wait covers that the editor reports changes asynchronously:
 *
 *   await expect.poll(() => reportedTexts(page)).toEqual(['Første avsnitt. Mer tekst.'])
 */
export const reportedTexts = async (page: Page) => texts(await blocksOf(page))
