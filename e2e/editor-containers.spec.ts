import { expect, test, type Page } from '@playwright/test'
import { blocksOf, caretAtEndOf, openEditor, setFromOutside } from './helpers/editor.ts'
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
