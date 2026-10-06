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

/** Is the browser's caret collapsed, and at the very end of the text node it is in? */
const caretIsAtEnd = (page: Page) => page.evaluate(() => {
  // Runs in the browser; this project has no DOM types, so the little that is used is described here.
  type Sel = { focusNode: { textContent: string | null } | null; isCollapsed: boolean; focusOffset: number } | null
  const s = (globalThis as unknown as { getSelection(): Sel }).getSelection()
  return !!s?.focusNode && s.isCollapsed && s.focusOffset === (s.focusNode.textContent?.length ?? -1)
})

/**
 * Put the caret at the end of the text that contains `text`, with a real click, and wait until it is there.
 *
 * The click goes to the right edge of the text, so the click itself places the caret at the end. Clicking
 * in the middle and pressing End does not work: the browser's selection moves at once, but the editor
 * takes it over asynchronously (slate throttles selection changes), and an Enter or a keystroke in that gap
 * acts on the old position and splits or garbles the text. A click at the end leaves nothing to catch up.
 */
export async function caretAtEndOf(page: Page, text: string) {
  const leaf = page.locator('.pt-editable').getByText(text, { exact: false }).first()
  const box = await leaf.boundingBox()
  if (!box) throw new Error(`«${text}» is not on screen`)
  await leaf.click({ position: { x: box.width - 1, y: box.height / 2 } })
  await page.keyboard.press('End')
  await expect.poll(() => caretIsAtEnd(page), { message: `the caret never reached the end of «${text}»` }).toBe(true)
}

/**
 * Press a key that changes the document (Enter, Tab) and wait until the editor has reported it. The next
 * key must not reach the editor before this one has been applied, or it acts on the old state.
 */
export async function pressAndWait(page: Page, key: string) {
  const before = await reportsOf(page)
  await page.keyboard.press(key)
  await expect.poll(() => reportsOf(page), { message: `the editor did not report ${key}` }).toBeGreaterThan(before)
}

/** The block's list kind and level, or null when it is not a list item. */
export const listOf = (b: Block) => (b.listItem ? { kind: b.listItem, level: b.level ?? 1 } : null)
