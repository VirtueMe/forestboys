import { expect, test } from '@playwright/test'
import { blocksOf, caretAtEndOf, listOf, openEditor, paste, reportedTexts, settleSelection, texts } from './helpers/editor.ts'

// Paste into the editor (#140): what text from a web page, Word or a plain text file becomes. These pin what the
// editor does today, so a change (an upgrade, a new schema) is seen. The first pasted block joins the text at
// the caret and the rest follow as blocks of their own: the editor's rule, not ours.
test.describe('paste', () => {
  /** The caret at the end of the paragraph, in the editor's own selection and not only the browser's. */
  const atEndOfParagraph = async (page: import('@playwright/test').Page) => {
    await openEditor(page, 'paragraph')
    await caretAtEndOf(page, 'Første avsnitt.')
    await settleSelection(page)
  }

  test('plain text: a blank line starts a new paragraph, and a single line break stays in the paragraph', async ({ page }) => {
    await atEndOfParagraph(page)
    await paste(page, { 'text/plain': 'Linje en\nLinje to\n\nNytt avsnitt' })
    await expect.poll(() => reportedTexts(page)).toEqual(['Første avsnitt.Linje en\nLinje to', 'Nytt avsnitt'])
  })

  test('plain text into an empty editor', async ({ page }) => {
    await openEditor(page, 'empty')
    await page.locator('.pt-editable').click()
    await settleSelection(page)
    await paste(page, { 'text/plain': 'Bare tekst\nto linjer' })
    await expect.poll(() => reportedTexts(page)).toEqual(['Bare tekst\nto linjer'])
  })

  test('plain text with a blank line, into a list item: the second paragraph becomes a new item of the same kind and level', async ({ page }) => {
    await openEditor(page, 'lists')
    await caretAtEndOf(page, 'Andre punkt')
    await settleSelection(page)
    await paste(page, { 'text/plain': 'Limt en\n\nLimt to' })
    await expect.poll(() => reportedTexts(page)).toEqual([
      'Første punkt', 'Andre punktLimt en', 'Limt to', 'Underpunkt', 'Første nummer', 'Et avsnitt etter listen.',
    ])
    expect((await blocksOf(page)).map(listOf)).toEqual([
      { kind: 'bullet', level: 1 }, { kind: 'bullet', level: 1 }, { kind: 'bullet', level: 1 },
      { kind: 'bullet', level: 2 }, { kind: 'number', level: 1 }, null,
    ])
  })

  test('from a web page: bold text and a link keep their marks, and the link its address', async ({ page }) => {
    await atEndOfParagraph(page)
    await paste(page, {
      'text/html': '<p>Fra <b>nettet</b> og <a href="https://example.org/x">en lenke</a></p>',
      'text/plain': 'Fra nettet og en lenke',
    })
    await expect.poll(() => reportedTexts(page)).toEqual(['Første avsnitt.Fra nettet og en lenke'])
    const [block] = await blocksOf(page)
    const marked = (text: string) => block.children?.find(c => c.text === text)
    expect(marked('nettet')?.marks).toEqual(['strong'])
    const link = marked('en lenke')
    expect(link?.marks).toHaveLength(1)
    expect(block.markDefs?.find(d => d._key === link?.marks?.[0])?.href).toBe('https://example.org/x')
  })

  test('from a web page: the editor has H3 to H6, so H3 and H4 stay and H1 and H2 become ordinary paragraphs', async ({ page }) => {
    await openEditor(page, 'empty')
    await page.locator('.pt-editable').click()
    await settleSelection(page)
    await paste(page, {
      'text/html': '<h1>Stor</h1><h2>Mellom</h2><h3>Tre</h3><h4>Fire</h4><p>Tekst</p>',
      'text/plain': 'Stor\nMellom\nTre\nFire\nTekst',
    })
    await expect.poll(() => reportedTexts(page)).toEqual(['Stor', 'Mellom', 'Tre', 'Fire', 'Tekst'])
    expect((await blocksOf(page)).map(b => b.style)).toEqual(['normal', 'normal', 'h3', 'h4', 'normal'])
  })

  test('from a web page: a nested list keeps its kind and its levels', async ({ page }) => {
    await openEditor(page, 'empty')
    await page.locator('.pt-editable').click()
    await settleSelection(page)
    await paste(page, {
      'text/html': '<ul><li>Eple</li><li>Pære<ul><li>Grønn</li></ul></li></ul><p>Slutt</p>',
      'text/plain': 'Eple\nPære\nGrønn\nSlutt',
    })
    await expect.poll(() => reportedTexts(page)).toEqual(['Eple', 'Pære', 'Grønn', 'Slutt'])
    expect((await blocksOf(page)).map(listOf)).toEqual([
      { kind: 'bullet', level: 1 }, { kind: 'bullet', level: 1 }, { kind: 'bullet', level: 2 }, null,
    ])
    expect(texts(await blocksOf(page))).toHaveLength(4)
  })
})
