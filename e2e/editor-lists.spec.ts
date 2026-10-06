import { expect, test } from '@playwright/test'
import { blocksOf, caretAtEndOf, caretAtStartOf, listOf, openEditor, pressAndWait, reportedTexts, settleSelection, texts } from './helpers/editor.ts'

// Lists in the editor (#124): they survive, they continue, they end, they indent.
test.describe('lists', () => {
  // The bullet button lights up from the editor's own selection, not the browser's. Waiting for it
  // proves the editor has the caret in a bullet item before a key such as Tab or Enter is pressed;
  // under load the click's selection reaches the editor late, and the key would find no caret.
  const editorHasCaretInBullet = (page: import('@playwright/test').Page) =>
    expect(page.getByRole('button', { name: 'Punktliste' })).toHaveClass(/active/)

  test('a stored list is kept as it is when text is added to it', async ({ page }) => {
    await openEditor(page, 'lists')
    await caretAtEndOf(page, 'Andre punkt')
    await editorHasCaretInBullet(page)
    await page.keyboard.type(' (endret)')
    await expect.poll(() => reportedTexts(page)).toContain('Andre punkt (endret)')
    const blocks = await blocksOf(page)
    expect(blocks.map(listOf)).toEqual([
      { kind: 'bullet', level: 1 },
      { kind: 'bullet', level: 1 },
      { kind: 'bullet', level: 2 },
      { kind: 'number', level: 1 },
      null,
    ])
  })

  test('Enter continues a list with a new item of the same kind and level', async ({ page }) => {
    await openEditor(page, 'lists')
    await caretAtEndOf(page, 'Underpunkt')
    await editorHasCaretInBullet(page)
    await pressAndWait(page, 'Enter')
    await page.keyboard.type('Nytt underpunkt')
    await expect.poll(() => reportedTexts(page)).toContain('Nytt underpunkt')
    const blocks = await blocksOf(page)
    const at = texts(blocks).indexOf('Nytt underpunkt')
    expect(listOf(blocks[at])).toEqual({ kind: 'bullet', level: 2 })
    expect(texts(blocks)).toEqual(['Første punkt', 'Andre punkt', 'Underpunkt', 'Nytt underpunkt', 'Første nummer', 'Et avsnitt etter listen.'])
  })

  test('Enter on an empty item ends the list', async ({ page }) => {
    await openEditor(page, 'paragraph')
    await caretAtEndOf(page, 'Første avsnitt.')
    await page.getByRole('button', { name: 'Punktliste' }).click()
    await pressAndWait(page, 'Enter')                                 // a new, empty item
    await pressAndWait(page, 'Enter')                                 // Enter on the empty item: out of the list
    await expect.poll(async () => (await blocksOf(page)).map(b => b.listItem ?? null)).toEqual(['bullet', null])
  })

  test('Tab indents an item and Shift+Tab takes it back', async ({ page }) => {
    await openEditor(page, 'lists')
    await caretAtEndOf(page, 'Andre punkt')
    await editorHasCaretInBullet(page)
    await pressAndWait(page, 'Tab')
    await expect.poll(async () => listOf((await blocksOf(page))[1])).toEqual({ kind: 'bullet', level: 2 })
    await pressAndWait(page, 'Shift+Tab')
    await expect.poll(async () => listOf((await blocksOf(page))[1])).toEqual({ kind: 'bullet', level: 1 })
  })

  test('the bullet and numbered buttons toggle a list on and off, and switch between kinds', async ({ page }) => {
    await openEditor(page, 'paragraph')
    await caretAtEndOf(page, 'Første avsnitt.')
    const kind = async () => (await blocksOf(page))[0].listItem ?? null

    await page.getByRole('button', { name: 'Punktliste' }).click()
    await expect.poll(kind).toBe('bullet')
    await page.getByRole('button', { name: 'Nummerert liste' }).click()
    await expect.poll(kind).toBe('number')
    await page.getByRole('button', { name: 'Nummerert liste' }).click()
    await expect.poll(kind).toBe(null)
  })

  // Backspace at the very start of an item: the editor's own rules, pinned so an upgrade that changes them is seen.
  test.describe('Backspace at the start of an item', () => {
    const editorHasCaretIn = (page: import('@playwright/test').Page, button: 'Punktliste' | 'Nummerert liste') =>
      expect(page.getByRole('button', { name: button })).toHaveClass(/active/)

    test('takes a top-level item out of the list and leaves the other items as they are', async ({ page }) => {
      await openEditor(page, 'lists')
      await caretAtStartOf(page, 'Andre punkt')
      await editorHasCaretIn(page, 'Punktliste')
      await pressAndWait(page, 'Backspace')
      await expect.poll(async () => (await blocksOf(page)).map(listOf)).toEqual([
        { kind: 'bullet', level: 1 }, null, { kind: 'bullet', level: 2 }, { kind: 'number', level: 1 }, null,
      ])
      expect(texts(await blocksOf(page))).toEqual(['Første punkt', 'Andre punkt', 'Underpunkt', 'Første nummer', 'Et avsnitt etter listen.'])
    })

    test('takes an indented item one level out, and keeps it in the list', async ({ page }) => {
      await openEditor(page, 'lists')
      await caretAtStartOf(page, 'Underpunkt')
      await editorHasCaretIn(page, 'Punktliste')
      await pressAndWait(page, 'Backspace')
      await expect.poll(async () => listOf((await blocksOf(page))[2])).toEqual({ kind: 'bullet', level: 1 })
    })

    test('takes a numbered item out of its list', async ({ page }) => {
      await openEditor(page, 'lists')
      await caretAtStartOf(page, 'Første nummer')
      await editorHasCaretIn(page, 'Nummerert liste')
      await pressAndWait(page, 'Backspace')
      await expect.poll(async () => listOf((await blocksOf(page))[3])).toBe(null)
      expect(texts(await blocksOf(page))[3]).toBe('Første nummer')
    })

    test('in the paragraph after a list, joins the paragraph to the last item', async ({ page }) => {
      await openEditor(page, 'lists')
      await caretAtStartOf(page, 'Et avsnitt etter listen.')
      await settleSelection(page)
      await pressAndWait(page, 'Backspace')
      await expect.poll(() => reportedTexts(page)).toEqual(['Første punkt', 'Andre punkt', 'Underpunkt', 'Første nummerEt avsnitt etter listen.'])
      expect(listOf((await blocksOf(page))[3])).toEqual({ kind: 'number', level: 1 })
    })
  })
})
