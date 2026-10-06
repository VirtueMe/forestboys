import { expect, type Page } from '@playwright/test'
import type { Block, Harness } from '../harness/types.ts'

type WithHarness = { __harness: Harness }

/**
 * Open the harness with a named fixture (e2e/harness/fixtures.ts) and wait for the editor to be there.
 * `scroller` puts the editor in a scroll container like the app's page, for the tests of where a scroll goes.
 */
export async function openEditor(page: Page, fixture = 'empty', options: { scroller?: boolean } = {}) {
  await page.goto(`/e2e/harness/editor.html?fixture=${fixture}${options.scroller ? '&scroller=1' : ''}`)
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

/** Is the browser's caret collapsed, and at the very start of the text node it is in? */
const caretIsAtStart = (page: Page) => page.evaluate(() => {
  type Sel = { focusNode: unknown; isCollapsed: boolean; focusOffset: number } | null
  const s = (globalThis as unknown as { getSelection(): Sel }).getSelection()
  return !!s?.focusNode && s.isCollapsed && s.focusOffset === 0
})

/**
 * Put the caret at the start of the text that contains `text`: the twin of `caretAtEndOf`, with the click at
 * the left edge. It only proves the browser's caret is there. The editor takes the selection over a moment
 * later, so wait on something the editor derives (a list button's `active` class) or `settleSelection`
 * before pressing a key that acts on the caret.
 */
export async function caretAtStartOf(page: Page, text: string) {
  const leaf = page.locator('.pt-editable').getByText(text, { exact: false }).first()
  const box = await leaf.boundingBox()
  if (!box) throw new Error(`«${text}» is not on screen`)
  await leaf.click({ position: { x: 1, y: box.height / 2 } })
  await page.keyboard.press('Home')
  await expect.poll(() => caretIsAtStart(page), { message: `the caret never reached the start of «${text}»` }).toBe(true)
}

/**
 * Paste, as the browser delivers it: a `paste` event carrying the given clipboard formats
 * (`{ 'text/plain': ..., 'text/html': ... }`). The real clipboard is not used: the test controls exactly what
 * is on it, and the editor reads the event's data and nothing else.
 */
export const paste = (page: Page, data: Record<string, string>) => page.locator('.pt-editable').evaluate((el, formats) => {
  type Transfer = { setData(type: string, value: string): void }
  const G = globalThis as unknown as { DataTransfer: new () => Transfer; ClipboardEvent: new (type: string, init: object) => unknown }
  const clipboardData = new G.DataTransfer()
  for (const [type, value] of Object.entries(formats)) clipboardData.setData(type, value)
  ;(el as unknown as { dispatchEvent(e: unknown): boolean }).dispatchEvent(new G.ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
}, data)

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

/** The span whose text is `text`, with its block. */
export function findSpan(blocks: Block[], text: string) {
  for (const block of blocks) {
    const span = (block.children ?? []).find(c => c.text === text)
    if (span) return { block, span }
  }
  return null
}

/** The address of the link on a span, or null when it has none. */
export function linkHref(block: Block, span: { marks?: string[] }) {
  const def = (block.markDefs ?? []).find(d => d._type === 'link' && (span.marks ?? []).includes(d._key))
  return def ? (def.href as string) : null
}

/**
 * Wait for the editor to take over a selection that was made with the keyboard or a double-click. The
 * link box reads the editor's own selection when it opens, and that follows the browser's with a delay
 * (slate throttles selection changes, about 100 ms): opening the box inside that gap shows the old
 * selection. Nothing on the page says when the editor has caught up, so this is a fixed wait, kept in
 * one place. A click does not need it where the caret is placed at the end of the text (caretAtEndOf).
 */
export const settleSelection = (page: Page) => page.waitForTimeout(250)

/**
 * One undo step, as the browser's own undo asks for it: a `beforeinput` event of type `historyUndo`, which
 * is what Ctrl/Cmd+Z produces and what the editor listens for. Pressing the shortcut itself is not used:
 * in the headless Chromium these tests run in it undid typed text but not a change made through the link
 * box, while in a real, windowed browser on the real page both are undone by the shortcut (checked by hand).
 *
 * The editor reports an undo about a second after it, against about 0.3 s for typed text, so wait for it
 * with `expect.poll` (5 s) and not with a short fixed wait.
 */
export const undo = (page: Page) => page.locator('.pt-editable').evaluate(el => {
  type Dispatcher = { dispatchEvent(e: unknown): boolean }
  const InputEvent = (globalThis as unknown as { InputEvent: new (type: string, init: object) => unknown }).InputEvent
  ;(el as unknown as Dispatcher).dispatchEvent(new InputEvent('beforeinput', { inputType: 'historyUndo', bubbles: true, cancelable: true }))
})

/** Put the caret inside the words of `text` (the middle of it), with a real click. */
export const caretInside = (page: Page, text: string) =>
  page.locator('.pt-editable').getByText(text, { exact: false }).first().click()
