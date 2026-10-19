import { expect, test, type Page } from '@playwright/test'
import { blocksOf, caretAtEndOf, openEditor, setFromOutside, settleSelection } from './helpers/editor.ts'
import type { Block } from './harness/types.ts'

// A box and a table in the editor (#312): the containers of a description, which hold blocks of their own.

/** The tree as lines: the containers by type, the text blocks by their text, indented by depth. */
const outline = (nodes: unknown, depth = 0): string[] =>
  (Array.isArray(nodes) ? nodes : []).flatMap((n: Block) => {
    const pad = '  '.repeat(depth)
    if (n._type === 'block') return [`${pad}${(n.children ?? []).map(c => c.text).join('')}`]
    const inside = ['content', 'rows', 'cells'].flatMap(f => (n[f] ? outline(n[f], depth + 1) : []))
    return [`${pad}<${n._type}>`, ...inside]
  })
const tree = async (page: Page) => outline(await blocksOf(page))

const box   = (page: Page) => page.getByRole('button', { name: 'Infoboks' })
const table = (page: Page) => page.getByRole('button', { name: 'Tabell med celler' })

test.describe('a box and a table', () => {
  test('a stored box and table are drawn as a box, a table and cells, with the text in them', async ({ page }) => {
    await openEditor(page, 'containers')
    await expect(page.locator('.pt-editable .pt-edit-box')).toHaveCount(1)
    await expect(page.locator('.pt-editable .pt-edit-grid')).toHaveCount(2)
    await expect(page.locator('.pt-editable .pt-edit-box .pt-edit-grid')).toHaveCount(1)
    await expect(page.locator('.pt-editable .pt-edit-cell')).toHaveCount(4)
    await expect(page.locator('.pt-editable .pt-edit-box')).toContainText('I boksen.')
    await expect(page.locator('.pt-editable .pt-edit-cell').nth(2)).toContainText('CON')
    await expect(page.locator('.pt-editable .pt-edit-cell').nth(2)).toContainText('PAK')
  })

  test('hands back what it was given, so a description with containers is saved as it was', async ({ page }) => {
    await openEditor(page, 'containers')
    const before = await tree(page)
    await caretAtEndOf(page, 'Før boksen.')
    await page.keyboard.type('!')
    await expect.poll(() => tree(page)).toEqual(before.map(l => (l === 'Før boksen.' ? 'Før boksen.!' : l)))
  })

  test('starts over from the outside with a container as well as from a fixture', async ({ page }) => {
    await openEditor(page, 'paragraph')
    await setFromOutside(page, (await blocksOf(page)).concat([
      { _key: 'bx', _type: 'infoBox', content: [{ _key: 'bp', _type: 'block', style: 'normal', markDefs: [], children: [{ _key: 'bs', _type: 'span', text: 'Utenfra', marks: [] }] }] },
    ]))
    await expect(page.locator('.pt-editable .pt-edit-box')).toContainText('Utenfra')
  })
})

test.describe('the box and table buttons', () => {
  test('a table is put after the paragraph with the caret, two rows of two empty cells, and the caret in the first', async ({ page }) => {
    await openEditor(page, 'paragraph')
    await caretAtEndOf(page, 'Første avsnitt.')
    await table(page).click()
    await expect(page.locator('.pt-editable .pt-edit-cell')).toHaveCount(4)
    await page.keyboard.type('A1')
    await expect.poll(() => tree(page)).toEqual([
      'Første avsnitt.',
      '<table>', '  <row>', '    <cell>', '      A1', '    <cell>', '      ',
      '  <row>', '    <cell>', '      ', '    <cell>', '      ',
    ])
  })

  test('a box is put after the paragraph with the caret, and a table can go into it', async ({ page }) => {
    await openEditor(page, 'paragraph')
    await caretAtEndOf(page, 'Første avsnitt.')
    await box(page).click()
    await page.keyboard.type('i boksen')
    await table(page).click()
    await expect.poll(async () => (await tree(page)).slice(0, 4)).toEqual(['Første avsnitt.', '<infoBox>', '  i boksen', '  <table>'])
    await expect(page.locator('.pt-editable .pt-edit-box .pt-edit-grid')).toHaveCount(1)
  })

  test('are off without a caret, and say why', async ({ page }) => {
    await openEditor(page, 'paragraph')
    await expect(box(page)).toBeDisabled()
    await expect(table(page)).toBeDisabled()
    await expect(box(page)).toHaveAttribute('title', 'Sett markøren i teksten først')
  })

  test('the box button is off in a box and in a cell; the table button only in a cell', async ({ page }) => {
    await openEditor(page, 'containers')
    await page.locator('.pt-editable .pt-edit-box > div').first().click()
    await expect(box(page)).toBeDisabled()
    await expect(table(page)).toBeEnabled()

    await page.locator('.pt-editable .pt-edit-cell').nth(2).click()
    await expect(box(page)).toBeDisabled()
    await expect(table(page)).toBeDisabled()
    await expect(table(page)).toHaveAttribute('title', 'En tabell kan ikke ligge i en tabellcelle')
  })

  test('the heading and fixed-width buttons are off in a cell, and on again outside it', async ({ page }) => {
    await openEditor(page, 'containers')
    const h3 = page.getByRole('button', { name: 'H3' })
    const fixed = page.getByRole('button', { name: 'Tabell', exact: true })
    await page.locator('.pt-editable .pt-edit-cell').nth(2).click()
    await expect(h3).toBeDisabled()
    await expect(fixed).toBeDisabled()
    await expect(h3).toHaveAttribute('title', 'Ikke tillatt i en tabellcelle')

    await caretAtEndOf(page, 'Etter tabellen.')
    await expect(h3).toBeEnabled()
    await expect(fixed).toBeEnabled()
  })
})

test.describe('the keyboard in a table', () => {
  /** A new 2 × 2 table with the caret in its first cell. */
  const newTable = async (page: Page) => {
    await openEditor(page, 'paragraph')
    await caretAtEndOf(page, 'Første avsnitt.')
    await table(page).click()
  }
  /** The text of each cell, row by row: `[['A', 'B'], ['C', '']]`. */
  const cells = async (page: Page) => {
    const t = ((await blocksOf(page)).find(n => n._type === 'table') ?? {}) as { rows?: { cells: { content: Block[] }[] }[] }
    return (t.rows ?? []).map(r => r.cells.map(c => c.content.map(b => (b.children ?? []).map(s => s.text).join('')).join('|')))
  }

  test('Tab goes to the next cell, along the row and then to the first cell of the next', async ({ page }) => {
    await newTable(page)
    await page.keyboard.type('A')
    await page.keyboard.press('Tab'); await page.keyboard.type('B')
    await page.keyboard.press('Tab'); await page.keyboard.type('C')
    await page.keyboard.press('Tab'); await page.keyboard.type('D')
    await expect.poll(() => cells(page)).toEqual([['A', 'B'], ['C', 'D']])
  })

  test('Tab in the last cell adds a row as wide as the table and goes to its first cell', async ({ page }) => {
    await newTable(page)
    await page.locator('.pt-editable .pt-edit-cell').nth(3).click()
    await settleSelection(page)
    await page.keyboard.type('D')
    await settleSelection(page)
    await page.keyboard.press('Tab')
    await page.keyboard.type('E')
    await expect.poll(() => cells(page)).toEqual([['', ''], ['', 'D'], ['E', '']])
    await expect(page.locator('.pt-editable .pt-edit-cell')).toHaveCount(6)
  })

  test('Shift+Tab goes back along the row and to the last cell of the row before', async ({ page }) => {
    await newTable(page)
    await page.locator('.pt-editable .pt-edit-cell').nth(2).click()
    await settleSelection(page)
    await page.keyboard.press('Shift+Tab'); await page.keyboard.type('X')
    await page.keyboard.press('Shift+Tab'); await page.keyboard.type('Y')
    await expect.poll(() => cells(page)).toEqual([['Y', 'X'], ['', '']])
  })

  test('Shift+Tab in the first cell leaves the editor, so the keyboard is not trapped, and writes nothing', async ({ page }) => {
    await newTable(page)
    await page.keyboard.press('Shift+Tab')
    const inside = await page.evaluate(() => !!(document.activeElement as { closest(s: string): unknown } | null)?.closest('.pt-editable'))
    expect(inside).toBe(false)
    await page.keyboard.type('x')
    await expect.poll(() => cells(page)).toEqual([['', ''], ['', '']])
  })

  test('Tab outside a table is the browser\'s: it writes nothing in the text', async ({ page }) => {
    await openEditor(page, 'containers')
    await caretAtEndOf(page, 'Før boksen.')
    await page.keyboard.press('Tab')
    await page.keyboard.type('x')
    await expect.poll(() => tree(page).then(t => t[0])).toBe('Før boksen.')
  })

  test('Tab works in a table inside a box', async ({ page }) => {
    await openEditor(page, 'containers')
    await page.locator('.pt-editable .pt-edit-box .pt-edit-cell').nth(0).click()
    await settleSelection(page)
    await page.keyboard.press('Tab'); await page.keyboard.type('!')
    // Tab puts the caret at the start of the cell, so what is typed goes before the text that is there.
    await expect.poll(async () => (await tree(page)).filter(l => l.includes('B1'))).toEqual(['        !B1'])
  })

  test('Enter in a cell adds a block in that cell, and Backspace at the start of it joins them again', async ({ page }) => {
    await newTable(page)
    await page.keyboard.type('X')
    await page.keyboard.press('Enter'); await page.keyboard.type('Y')
    await expect.poll(() => cells(page)).toEqual([['X|Y', ''], ['', '']])
    await settleSelection(page)
    await page.keyboard.press('ArrowLeft'); await settleSelection(page); await page.keyboard.press('Backspace')   // the caret is before «Y», at the start of its block
    await expect.poll(() => cells(page)).toEqual([['XY', ''], ['', '']])
  })

  test('Backspace at the start of the first cell leaves the paragraph before the table whole', async ({ page }) => {
    await newTable(page)
    await settleSelection(page)
    await page.keyboard.press('Backspace')
    await page.waitForTimeout(800)
    expect((await tree(page))[0]).toBe('Første avsnitt.')
    await expect.poll(() => cells(page)).toEqual([['', ''], ['', '']])
  })

  test('Backspace at the start of a cell does not take text from the cell before', async ({ page }) => {
    await newTable(page)
    await page.keyboard.type('A')
    await page.keyboard.press('Tab'); await page.keyboard.type('B')
    await settleSelection(page)
    await page.keyboard.press('ArrowLeft'); await settleSelection(page); await page.keyboard.press('Backspace')
    await page.waitForTimeout(800)
    await expect.poll(() => cells(page)).toEqual([['A', 'B'], ['', '']])
  })

  test('Delete at the end of a cell does not pull in the next cell', async ({ page }) => {
    await newTable(page)
    await page.keyboard.type('A')
    await page.keyboard.press('Tab'); await page.keyboard.type('B')
    await page.keyboard.press('Shift+Tab')
    await settleSelection(page)
    await page.keyboard.press('End'); await settleSelection(page); await page.keyboard.press('Delete')
    await page.waitForTimeout(800)
    await expect.poll(() => cells(page)).toEqual([['A', 'B'], ['', '']])
  })

  test('Backspace and Delete inside a cell\'s text work as anywhere', async ({ page }) => {
    await newTable(page)
    await page.keyboard.type('ABC')
    await page.keyboard.press('Backspace')
    await settleSelection(page)
    await page.keyboard.press('ArrowLeft'); await settleSelection(page); await page.keyboard.press('Delete')
    await expect.poll(() => cells(page)).toEqual([['A', ''], ['', '']])
  })
})
