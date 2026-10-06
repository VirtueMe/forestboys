import { expect, test } from '@playwright/test'
import { blocksOf, caretAtEndOf, listOf, openEditor, pressAndWait, reportedTexts, texts } from './helpers/editor.ts'

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
})
