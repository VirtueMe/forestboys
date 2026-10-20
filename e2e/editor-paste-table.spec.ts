import { expect, test, type Page } from '@playwright/test'
import { blocksOf, caretAtEndOf, openEditor, paste, settleSelection, undo } from './helpers/editor.ts'
import type { Block } from './harness/types.ts'

// A table on the clipboard is pasted as a table (#328): the <table> of Word or a web page, or the rows of Excel.

const outline = (nodes: unknown, depth = 0): string[] =>
  (Array.isArray(nodes) ? nodes : []).flatMap((n: Block) => {
    const pad = '  '.repeat(depth)
    if (n._type === 'block') return [`${pad}${(n.children ?? []).map(c => c.text).join('')}`]
    return [`${pad}<${n._type}>`, ...['content', 'rows', 'cells'].flatMap(f => (n[f] ? outline(n[f], depth + 1) : []))]
  })
const tree = async (page: Page) => outline(await blocksOf(page))
/** The tops of the tree: containers and top-level text, without what is inside them. */
const top = async (page: Page) => (await tree(page)).filter(l => !l.startsWith(' '))

const firstTable = async (page: Page) => (await blocksOf(page)).find(b => b._type === 'table') as Block
const cells = async (page: Page) =>
  (((await firstTable(page))?.rows ?? []) as Block[]).map(r => ((r.cells ?? []) as Block[]).map(c => ((c.content ?? []) as Block[]).map(b => (b.children ?? []).map(s => s.text).join('')).join(' / ')))

const html = '<table><tr><th>Navn</th><th>By</th></tr><tr><td>Eva</td><td>Bergen</td></tr><tr><td>Martin</td><td>Oslo</td></tr></table>'

const atEnd = async (page: Page) => {
  await openEditor(page, 'paragraph')
  await caretAtEndOf(page, 'Første avsnitt.')
  await settleSelection(page)
}

test.describe('paste a table', () => {
  test('an HTML table becomes a table after the paragraph, with an empty paragraph below it, and the caret in its first cell', async ({ page }) => {
    await atEnd(page)
    await paste(page, { 'text/html': html, 'text/plain': 'Navn\tBy\nEva\tBergen\nMartin\tOslo' })
    await expect.poll(() => cells(page)).toEqual([['Navn', 'By'], ['Eva', 'Bergen'], ['Martin', 'Oslo']])
    await expect.poll(() => top(page)).toEqual(['Første avsnitt.', '<table>', ''])
    await settleSelection(page)
    await page.keyboard.type('!')
    await expect.poll(() => cells(page).then(c => c[0][0])).toBe('!Navn')
  })

  test('the header cells are bold, and bold, italic and links in a cell keep their marks', async ({ page }) => {
    await atEnd(page)
    await paste(page, {
      'text/html': '<table><tr><th>Navn</th></tr><tr><td>Fra <b>nettet</b> og <a href="https://example.org/x">en lenke</a></td></tr></table>',
      'text/plain': 'x',
    })
    await expect.poll(() => cells(page)).toEqual([['Navn'], ['Fra nettet og en lenke']])
    const t = await firstTable(page)
    const block = (r: number) => (((t.rows as Block[])[r].cells as Block[])[0].content as Block[])[0]
    expect(block(0).children![0].marks).toEqual(['strong'])
    const children = block(1).children!
    expect(children.find(c => c.text === 'nettet')?.marks).toEqual(['strong'])
    const link = children.find(c => c.text === 'en lenke')!
    expect(block(1).markDefs!.find(d => d._key === link.marks![0])?.href).toBe('https://example.org/x')
  })

  test('a short row is padded, a colspan takes the columns it spans, and a cell with several paragraphs keeps them', async ({ page }) => {
    await atEnd(page)
    await paste(page, {
      'text/html': '<table><tr><td colspan="2">Samlet</td></tr><tr><td>a</td><td><p>b1</p><p>b2</p></td></tr><tr><td>c</td></tr></table>',
      'text/plain': 'x',
    })
    await expect.poll(() => cells(page)).toEqual([['Samlet', ''], ['a', 'b1 / b2'], ['c', '']])
  })

  test('Excel rows as plain text become a table', async ({ page }) => {
    await atEnd(page)
    await paste(page, { 'text/plain': 'Navn\tBy\r\nEva\tBergen\r\n' })
    await expect.poll(() => cells(page)).toEqual([['Navn', 'By'], ['Eva', 'Bergen']])
  })

  test('into an empty paragraph the table goes before it, and the empty paragraph stays as the one below', async ({ page }) => {
    await openEditor(page, 'empty')
    await page.locator('.pt-editable').click()
    await settleSelection(page)
    await paste(page, { 'text/plain': 'a\tb\nc\td' })
    await expect.poll(() => top(page)).toEqual(['<table>', ''])
  })

  test('is one undo step', async ({ page }) => {
    await atEnd(page)
    const before = await tree(page)
    await paste(page, { 'text/html': html })
    await expect.poll(async () => (await top(page))[1]).toBe('<table>')
    await undo(page)
    await expect.poll(() => tree(page)).toEqual(before)
  })

  test('is left to the ordinary paste when it is not a table: one cell, one line with a tab, text with no tabs', async ({ page }) => {
    await atEnd(page)
    await paste(page, { 'text/html': '<table><tr><td>ord</td></tr></table>', 'text/plain': 'ord' })
    await expect.poll(async () => (await tree(page))[0]).toBe('Første avsnitt.ord')
    await paste(page, { 'text/plain': 'x\ty' })
    await expect.poll(async () => (await tree(page))[0]).toBe('Første avsnitt.ordx\ty')
    expect(await top(page)).toEqual(['Første avsnitt.ordx\ty'])
  })

  test('is left to the ordinary paste when text comes with the table', async ({ page }) => {
    await atEnd(page)
    await paste(page, { 'text/html': `<p>Se tabellen:</p>${html}`, 'text/plain': 'Se tabellen:\nNavn\tBy' })
    await expect.poll(async () => (await top(page)).includes('<table>')).toBe(false)
  })

  test('is left to the ordinary paste in a heading and in a list', async ({ page }) => {
    await openEditor(page, 'headings')
    await page.locator('.pt-editable h3').first().click()
    await settleSelection(page)
    await paste(page, { 'text/plain': 'a\tb\nc\td' })
    await settleSelection(page)
    expect((await blocksOf(page)).some(b => b._type === 'table')).toBe(false)

    await openEditor(page, 'lists')
    await caretAtEndOf(page, 'Andre punkt')
    await settleSelection(page)
    await paste(page, { 'text/plain': 'a\tb\nc\td' })
    await settleSelection(page)
    expect((await blocksOf(page)).some(b => b._type === 'table')).toBe(false)
  })

  test('is left to the ordinary paste in a table cell: no table in a cell', async ({ page }) => {
    await openEditor(page, 'containers')
    await page.locator('.pt-editable .pt-edit-cell').nth(0).click()
    await settleSelection(page)
    await paste(page, { 'text/html': html, 'text/plain': 'Navn\tBy\nEva\tBergen' })
    await settleSelection(page)
    await expect(page.locator('.pt-editable .pt-edit-cell .pt-edit-grid')).toHaveCount(0)
    await expect(page.locator('.pt-editable .pt-edit-grid')).toHaveCount(2)
  })

  test('in a box the table goes into the box', async ({ page }) => {
    await openEditor(page, 'containers')
    await page.locator('.pt-editable .pt-edit-box > div').first().click()
    await settleSelection(page)
    await paste(page, { 'text/html': html })
    await settleSelection(page)
    await expect(page.locator('.pt-editable .pt-edit-box .pt-edit-grid')).toHaveCount(2)
  })
})
