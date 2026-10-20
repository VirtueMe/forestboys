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
      '',   // a table that ends the text gets an empty paragraph after it, to write in
    ])
  })

  test('a table put last in a box gets an empty paragraph after it in the box', async ({ page }) => {
    await openEditor(page, 'paragraph')
    await caretAtEndOf(page, 'Første avsnitt.')
    await box(page).click()
    await table(page).click()
    await expect.poll(async () => (await tree(page)).filter(l => !l.startsWith('      ') && !l.startsWith('    <') && !l.startsWith('  <row>')))
      .toEqual(['Første avsnitt.', '<infoBox>', '  ', '  <table>', '  '])
  })

  test('ArrowDown at the end of the last cell of a last table adds a paragraph after it and goes there', async ({ page }) => {
    await openEditor(page, 'paragraph')
    const cell = (k: string, text: string) => ({ _key: `tc${k}`, _type: 'cell', content: [{ _key: `tp${k}`, _type: 'block', style: 'normal', markDefs: [], children: [{ _key: `ts${k}`, _type: 'span', text, marks: [] }] }] })
    await setFromOutside(page, (await blocksOf(page)).concat([
      { _key: 'bx', _type: 'infoBox', content: [{ _key: 't', _type: 'table', rows: [{ _key: 'r', _type: 'row', cells: [cell('1', 'A'), cell('2', 'B')] }] }] },
    ]))
    await caretAtEndOf(page, 'B')
    await settleSelection(page)
    await page.keyboard.press('ArrowDown')
    await settleSelection(page)
    await page.keyboard.type('Etter')
    await expect.poll(async () => (await tree(page)).at(-1)).toBe('  Etter')
    await expect.poll(async () => (await tree(page)).at(-2)).toBe('        B')
  })

  test('«Avsnitt etter» in the table tools adds a paragraph after a table that has none, so it can be got back later', async ({ page }) => {
    await openEditor(page, 'paragraph')
    const cell = { _key: 'tc1', _type: 'cell', content: [{ _key: 'tp1', _type: 'block', style: 'normal', markDefs: [], children: [{ _key: 'ts1', _type: 'span', text: 'Celle', marks: [] }] }] }
    await setFromOutside(page, (await blocksOf(page)).concat([{ _key: 't', _type: 'table', rows: [{ _key: 'r', _type: 'row', cells: [cell] }] }]))
    await expect(page.locator('.pt-editable .pt-edit-cell')).toContainText('Celle')
    await caretAtEndOf(page, 'Celle')
    await settleSelection(page)
    await page.getByRole('button', { name: 'Tabellverktøy' }).click()
    await page.getByRole('button', { name: 'Nytt avsnitt etter tabellen' }).click()
    await settleSelection(page)
    await page.keyboard.type('Tilbake')
    await expect.poll(async () => (await tree(page)).at(-1)).toBe('Tilbake')
    await expect.poll(async () => (await tree(page)).at(-2)).toBe('      Celle')
  })

  test('ArrowDown in a table with something after it moves on as it always did, and adds nothing', async ({ page }) => {
    await openEditor(page, 'containers')
    const before = await tree(page)
    await page.locator('.pt-editable .pt-edit-cell').last().click()
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowDown')
    expect(await tree(page)).toEqual(before)
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

  test('in a box the box button takes the box apart and the table button still works; in a cell both are off', async ({ page }) => {
    await openEditor(page, 'containers')
    await page.locator('.pt-editable .pt-edit-box > div').first().click()
    await expect(box(page)).toBeEnabled()
    await expect(box(page)).toHaveAttribute('title', 'Løs opp infoboksen: innholdet blir stående')
    await expect(table(page)).toBeEnabled()

    await page.locator('.pt-editable .pt-edit-cell').nth(2).click()
    await expect(box(page)).toBeDisabled()
    await expect(table(page)).toBeDisabled()
    await expect(table(page)).toHaveAttribute('title', 'En tabell kan ikke ligge i en tabellcelle')
  })

  test('the heading button is off in a cell, and on again outside it', async ({ page }) => {
    await openEditor(page, 'containers')
    const h3 = page.getByRole('button', { name: 'H3' })
    await page.locator('.pt-editable .pt-edit-cell').nth(2).click()
    await expect(h3).toBeDisabled()
    await expect(h3).toHaveAttribute('title', 'Ikke tillatt i en tabellcelle')

    await caretAtEndOf(page, 'Etter tabellen.')
    await expect(h3).toBeEnabled()
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

test.describe('the table tools', () => {
  const tools = (page: Page) => page.getByRole('button', { name: 'Tabellverktøy' })
  const use = async (page: Page, name: string) => {
    if (await page.getByRole('group', { name: 'Tabellverktøy' }).count() === 0) await tools(page).click()
    await page.getByRole('button', { name }).click()
  }
  const newTable = async (page: Page, fixture = 'paragraph') => {
    await openEditor(page, fixture)
    await caretAtEndOf(page, 'Første avsnitt.')
    await table(page).click()
    await settleSelection(page)
  }
  /** The text of each cell, row by row, of the first table at the top. */
  const cells = async (page: Page) => {
    const t = ((await blocksOf(page)).find(n => n._type === 'table') ?? {}) as { rows?: { cells: { content: Block[] }[] }[] }
    return (t.rows ?? []).map(r => r.cells.map(c => c.content.map(b => (b.children ?? []).map(sp => sp.text).join('')).join('|')))
  }
  /** Put a letter in each cell of a new 2 × 2 table, so a change in its shape can be read. */
  const filled = async (page: Page) => {
    await newTable(page)
    await page.keyboard.type('A')
    await page.keyboard.press('Tab'); await page.keyboard.type('B')
    await page.keyboard.press('Tab'); await page.keyboard.type('C')
    await page.keyboard.press('Tab'); await page.keyboard.type('D')
    await expect.poll(() => cells(page)).toEqual([['A', 'B'], ['C', 'D']])
    await page.locator('.pt-editable .pt-edit-cell').nth(1).click()    // the caret in B
    await settleSelection(page)
  }

  test('the button is off outside a table and on in a cell, and says what it is for', async ({ page }) => {
    await openEditor(page, 'containers')
    await expect(tools(page)).toBeDisabled()
    await expect(tools(page)).toHaveAttribute('title', 'Sett markøren i en tabellcelle for å bruke tabellverktøyene')
    await page.locator('.pt-editable .pt-edit-cell').nth(2).click()
    await expect(tools(page)).toBeEnabled()
  })

  test('opens a panel with the row, column and table tools, and Esc closes it', async ({ page }) => {
    await newTable(page)
    await tools(page).click()
    const panel = page.getByRole('group', { name: 'Tabellverktøy' })
    await expect(panel).toBeVisible()
    for (const name of ['Ny rad over', 'Ny rad under', 'Slett rad', 'Ny kolonne før', 'Ny kolonne etter', 'Slett kolonne', 'Slett tabell']) {
      await expect(page.getByRole('button', { name })).toBeVisible()
    }
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
  })

  test('adds a row below or above, and the caret stays in its cell', async ({ page }) => {
    await filled(page)
    await use(page, 'Ny rad under')
    await expect.poll(() => cells(page)).toEqual([['A', 'B'], ['', ''], ['C', 'D']])
    await page.keyboard.type('1')
    await expect.poll(() => cells(page)).toEqual([['A', 'B1'], ['', ''], ['C', 'D']])
    await use(page, 'Ny rad over')
    await expect.poll(() => cells(page)).toEqual([['', ''], ['A', 'B1'], ['', ''], ['C', 'D']])
  })

  test('adds a column before or after, in every row, and the caret stays in its cell', async ({ page }) => {
    await filled(page)
    await use(page, 'Ny kolonne etter')
    await expect.poll(() => cells(page)).toEqual([['A', 'B', ''], ['C', 'D', '']])
    await page.keyboard.type('1')
    await expect.poll(() => cells(page)).toEqual([['A', 'B1', ''], ['C', 'D', '']])
    await use(page, 'Ny kolonne før')
    await expect.poll(() => cells(page)).toEqual([['A', '', 'B1', ''], ['C', '', 'D', '']])
  })

  test('the panel stays open after a row or a column is added, for the next one', async ({ page }) => {
    await filled(page)
    await use(page, 'Ny kolonne etter')
    await use(page, 'Ny rad under')
    await use(page, 'Ny kolonne etter')
    await expect(page.getByRole('group', { name: 'Tabellverktøy' })).toBeVisible()
    await expect.poll(() => cells(page)).toEqual([['A', 'B', '', ''], ['', '', '', ''], ['C', 'D', '', '']])
  })

  test('deletes the row the caret is in, and the caret goes to the row that took its place', async ({ page }) => {
    await filled(page)
    await use(page, 'Slett rad')
    await expect.poll(() => cells(page)).toEqual([['C', 'D']])
    await settleSelection(page)
    await page.keyboard.type('!')
    await expect.poll(() => cells(page)).toEqual([['C', '!D']])
  })

  test('deletes the column the caret is in, and the caret goes to the cell that took its place', async ({ page }) => {
    await filled(page)
    await use(page, 'Slett kolonne')
    await expect.poll(() => cells(page)).toEqual([['A'], ['C']])
    await settleSelection(page)
    await page.keyboard.type('!')
    await expect.poll(() => cells(page)).toEqual([['!A'], ['C']])
  })

  test('keeps one row and one column: the delete buttons are off for the last of them', async ({ page }) => {
    await filled(page)
    await use(page, 'Slett rad')      // the caret was in B, so it goes to D, the cell of its column in the row that took its place
    await use(page, 'Slett kolonne')  // and D's column goes
    await expect.poll(() => cells(page)).toEqual([['C']])
    await expect(page.getByRole('button', { name: 'Slett rad' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Slett kolonne' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Slett tabell' })).toBeEnabled()
  })

  test('is one undo step: a row added is gone with one Ctrl+Z', async ({ page }) => {
    await filled(page)
    await use(page, 'Ny rad under')
    await expect.poll(() => cells(page)).toHaveLength(3)
    await settleSelection(page)
    await page.keyboard.press('Control+z')
    await expect.poll(() => cells(page)).toEqual([['A', 'B'], ['C', 'D']])
  })

  test('deletes the table and puts the caret in the paragraph before it', async ({ page }) => {
    await newTable(page)
    await use(page, 'Slett tabell')
    await expect.poll(() => tree(page)).toEqual(['Første avsnitt.', ''])
    await settleSelection(page)
    await page.keyboard.type('!')
    await expect.poll(() => tree(page)).toEqual(['!Første avsnitt.', ''])
  })

  test('deletes a table in a box and leaves the box with what else it held', async ({ page }) => {
    await openEditor(page, 'containers')
    await page.locator('.pt-editable .pt-edit-box .pt-edit-cell').nth(0).click()
    await settleSelection(page)
    await use(page, 'Slett tabell')
    await expect.poll(async () => (await tree(page)).slice(0, 4)).toEqual(['Før boksen.', '<infoBox>', '  I boksen.', '<table>'])
  })

  test('deletes the only thing in a box, and the box gets an empty paragraph so it can still be written in', async ({ page }) => {
    await openEditor(page, 'paragraph')
    await setFromOutside(page, [
      { _key: 'p', _type: 'block', style: 'normal', markDefs: [], children: [{ _key: 'ps', _type: 'span', text: 'Før.', marks: [] }] },
      { _key: 'b', _type: 'infoBox', content: [{ _key: 't', _type: 'table', rows: [{ _key: 'r', _type: 'row', cells: [{ _key: 'c', _type: 'cell', content: [{ _key: 'x', _type: 'block', style: 'normal', markDefs: [], children: [{ _key: 'xs', _type: 'span', text: 'cellen', marks: [] }] }] }] }] }] },
    ])
    await page.locator('.pt-editable .pt-edit-cell').first().click()
    await settleSelection(page)
    await use(page, 'Slett tabell')
    await expect.poll(() => tree(page)).toEqual(['Før.', '<infoBox>', '  '])
  })
})

test.describe('wrapping in a box and taking a box apart', () => {
  const para = (key: string, text: string) => ({ _key: key, _type: 'block', style: 'normal', markDefs: [], children: [{ _key: `${key}s`, _type: 'span', text, marks: [] }] })
  const three = [para('p1', 'Første.'), para('p2', 'Andre.'), para('p3', 'Tredje.')]

  test('takes the box the caret is in apart: what it held stays where the box was, in order, a table included', async ({ page }) => {
    await openEditor(page, 'containers')
    const before = await tree(page)
    expect(before.slice(0, 4)).toEqual(['Før boksen.', '<infoBox>', '  I boksen.', '  <table>'])
    await page.locator('.pt-editable .pt-edit-box > div').first().click()
    await settleSelection(page)
    await box(page).click()
    await expect.poll(async () => (await tree(page)).slice(0, 4)).toEqual(['Før boksen.', 'I boksen.', '<table>', '  <row>'])
    expect(await tree(page)).not.toContain('<infoBox>')
    await expect(page.locator('.pt-editable .pt-edit-box')).toHaveCount(0)
    expect((await tree(page)).at(-1)).toBe('Etter tabellen.')
  })

  test('puts the blocks a selection spans in one box, and the rest stays outside', async ({ page }) => {
    await openEditor(page, 'paragraph')
    await setFromOutside(page, three)
    await page.locator('.pt-editable p').nth(0).click()
    await settleSelection(page)
    await page.keyboard.press('Shift+ArrowDown')
    await settleSelection(page)
    await expect(box(page)).toHaveAttribute('title', 'Sett det merkede i en infoboks')
    await box(page).click()
    await expect.poll(() => tree(page)).toEqual(['<infoBox>', '  Første.', '  Andre.', 'Tredje.'])
  })

  test('is off for a selection that takes in a box, and says why', async ({ page }) => {
    await openEditor(page, 'containers')
    await caretAtEndOf(page, 'Før boksen.')
    await settleSelection(page)
    await page.keyboard.press('Shift+ArrowDown')
    await settleSelection(page)
    await expect(box(page)).toBeDisabled()
    await expect(box(page)).toHaveAttribute('title', 'Det merkede kan ikke settes i en infoboks')
  })

  test('wrap and unwrap are each one undo step', async ({ page }) => {
    await openEditor(page, 'paragraph')
    await setFromOutside(page, three)
    await page.locator('.pt-editable p').nth(0).click()
    await settleSelection(page)
    await page.keyboard.press('Shift+ArrowDown')
    await settleSelection(page)
    await box(page).click()
    await expect.poll(() => tree(page)).toEqual(['<infoBox>', '  Første.', '  Andre.', 'Tredje.'])
    await settleSelection(page)
    await page.keyboard.press('Control+z')
    await expect.poll(() => tree(page)).toEqual(['Første.', 'Andre.', 'Tredje.'])
  })
})

test.describe('the options of a table', () => {
  const tools = (page: Page) => page.getByRole('button', { name: 'Tabellverktøy' })
  const option = (page: Page, name: string) => page.getByRole('button', { name })
  /** The first table anywhere in the value, as the editor reported it. */
  const firstTable = async (page: Page): Promise<Record<string, unknown>> => {
    const find = (nodes: unknown): Record<string, unknown> | null => {
      for (const n of (Array.isArray(nodes) ? nodes : []) as Block[]) {
        if (n._type === 'table') return n
        for (const f of ['content', 'rows', 'cells']) { const hit = n[f] ? find(n[f]) : null; if (hit) return hit }
      }
      return null
    }
    return find(await blocksOf(page)) ?? {}
  }
  const fields = async (page: Page) => {
    const t = await firstTable(page)
    return { frame: t.frame, width: t.width, rowLines: t.rowLines, columnLines: t.columnLines }
  }
  const newTable = async (page: Page) => {
    await openEditor(page, 'paragraph')
    await caretAtEndOf(page, 'Første avsnitt.')
    await page.getByRole('button', { name: 'Tabell med celler' }).click()
    await settleSelection(page)
    await tools(page).click()
  }

  test('a new table has no options, and the panel shows no frame and no rules', async ({ page }) => {
    await newTable(page)
    await expect(option(page, 'Ingen ramme')).toHaveAttribute('aria-pressed', 'true')
    await expect(option(page, 'Ramme topp og bunn')).toHaveAttribute('aria-pressed', 'false')
    await expect(option(page, 'Ramme rundt')).toHaveAttribute('aria-pressed', 'false')
    await expect(option(page, 'Linjer mellom rader')).toHaveAttribute('aria-pressed', 'false')
    await expect(option(page, 'Linjer mellom kolonner')).toHaveAttribute('aria-pressed', 'false')
    expect(await fields(page)).toEqual({ frame: undefined, rowLines: undefined, columnLines: undefined })
  })

  test('the frame is one of none, top and bottom, around: choosing one replaces the other', async ({ page }) => {
    await newTable(page)
    await option(page, 'Ramme rundt').click()
    await expect.poll(() => fields(page)).toEqual({ frame: 'around', width: undefined, rowLines: undefined, columnLines: undefined })
    await expect(option(page, 'Ramme rundt')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.pt-editable .pt-edit-grid--around')).toHaveCount(1)

    await option(page, 'Ramme topp og bunn').click()
    await expect.poll(() => fields(page)).toEqual({ frame: 'topBottom', width: undefined, rowLines: undefined, columnLines: undefined })
    await expect(option(page, 'Ramme rundt')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('.pt-editable .pt-edit-grid--topbottom')).toHaveCount(1)
    await expect(page.locator('.pt-editable .pt-edit-grid--around')).toHaveCount(0)
  })

  test('the width is compact or full: full is a field and a class, compact takes the field away', async ({ page }) => {
    await newTable(page)
    await expect(option(page, 'Bredde kompakt')).toHaveAttribute('aria-pressed', 'true')
    await option(page, 'Bredde full').click()
    await expect.poll(() => fields(page)).toEqual({ frame: undefined, width: 'full', rowLines: undefined, columnLines: undefined })
    await expect(option(page, 'Bredde full')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.pt-editable .pt-edit-grid--full')).toHaveCount(1)

    await option(page, 'Bredde kompakt').click()
    await expect.poll(() => fields(page)).toEqual({ frame: undefined, width: undefined, rowLines: undefined, columnLines: undefined })
    await expect(page.locator('.pt-editable .pt-edit-grid--full')).toHaveCount(0)
  })

  test('none takes the frame field away, so a plain table is plain data', async ({ page }) => {
    await newTable(page)
    await option(page, 'Ramme rundt').click()
    await expect.poll(async () => (await firstTable(page)).frame).toBe('around')
    await option(page, 'Ingen ramme').click()
    await expect.poll(async () => 'frame' in (await firstTable(page))).toBe(false)
  })

  test('the rules between rows and between columns are switches, and off takes the field away', async ({ page }) => {
    await newTable(page)
    await option(page, 'Linjer mellom rader').click()
    await option(page, 'Linjer mellom kolonner').click()
    await expect.poll(() => fields(page)).toEqual({ frame: undefined, rowLines: true, columnLines: true })
    await expect(page.locator('.pt-editable .pt-edit-grid--rows.pt-edit-grid--columns')).toHaveCount(1)

    await option(page, 'Linjer mellom rader').click()
    await expect.poll(async () => 'rowLines' in (await firstTable(page))).toBe(false)
    await expect(option(page, 'Linjer mellom rader')).toHaveAttribute('aria-pressed', 'false')
    expect((await firstTable(page)).columnLines).toBe(true)
  })

  test('the panel stays open for the next change, and the cells are not touched', async ({ page }) => {
    await newTable(page)
    await page.keyboard.press('Escape')                       // close it to type in the first cell
    await page.locator('.pt-editable .pt-edit-cell').first().click()
    await page.keyboard.type('A')
    await tools(page).click()
    await option(page, 'Linjer mellom rader').click()
    await option(page, 'Ramme rundt').click()
    await expect(page.getByRole('group', { name: 'Tabellverktøy' })).toBeVisible()
    await expect.poll(() => fields(page)).toEqual({ frame: 'around', width: undefined, rowLines: true, columnLines: undefined })
    const t = await firstTable(page) as { rows: { cells: { content: Block[] }[] }[] }
    expect((t.rows[0].cells[0].content[0].children ?? []).map(c => c.text).join('')).toBe('A')
  })

  test('is one undo step: one Ctrl+Z takes the last option back', async ({ page }) => {
    await newTable(page)
    await option(page, 'Ramme rundt').click()
    await option(page, 'Linjer mellom rader').click()
    await expect.poll(() => fields(page)).toEqual({ frame: 'around', width: undefined, rowLines: true, columnLines: undefined })
    await page.keyboard.press('Escape')
    await settleSelection(page)
    await page.keyboard.press('Control+z')
    await expect.poll(() => fields(page)).toEqual({ frame: 'around', width: undefined, rowLines: undefined, columnLines: undefined })
  })

  test('a stored table with options is drawn with them, and the panel shows them', async ({ page }) => {
    await openEditor(page, 'paragraph')
    const para = { _key: 'p', _type: 'block', style: 'normal', markDefs: [], children: [{ _key: 'ps', _type: 'span', text: 'x', marks: [] }] }
    await setFromOutside(page, [{
      _key: 't', _type: 'table', frame: 'topBottom', rowLines: true, columnLines: true,
      rows: [{ _key: 'r', _type: 'row', cells: [{ _key: 'c1', _type: 'cell', content: [para] }, { _key: 'c2', _type: 'cell', content: [{ ...para, _key: 'q' }] }] }],
    }])
    await expect(page.locator('.pt-editable .pt-edit-grid--topbottom.pt-edit-grid--rows.pt-edit-grid--columns')).toHaveCount(1)
    await page.locator('.pt-editable .pt-edit-cell').first().click()
    await settleSelection(page)
    await tools(page).click()
    await expect(option(page, 'Ramme topp og bunn')).toHaveAttribute('aria-pressed', 'true')
    await expect(option(page, 'Linjer mellom rader')).toHaveAttribute('aria-pressed', 'true')
    await expect(option(page, 'Linjer mellom kolonner')).toHaveAttribute('aria-pressed', 'true')
  })

  test('works on a table in a box, and leaves the box alone', async ({ page }) => {
    await openEditor(page, 'containers')
    await page.locator('.pt-editable .pt-edit-box .pt-edit-cell').first().click()
    await settleSelection(page)
    await tools(page).click()
    await option(page, 'Ramme rundt').click()
    await expect.poll(async () => (await firstTable(page)).frame).toBe('around')
    expect((await tree(page)).slice(0, 4)).toEqual(['Før boksen.', '<infoBox>', '  I boksen.', '  <table>'])
    await expect(page.locator('.pt-editable .pt-edit-box .pt-edit-grid--around')).toHaveCount(1)
  })
})
