import { expect, test, type Page } from '@playwright/test'
import { blocksOf, openEditor, setFromOutside, settleSelection, undo } from './helpers/editor.ts'
import type { Block } from './harness/types.ts'

// Text from a scan turned into a table (#328): lines split on a tab, runs of spaces, ; or |.

const para = (key: string, text: string, extra: Partial<Block> = {}): Block =>
  ({ _key: `x${key}`, _type: 'block', style: 'normal', markDefs: [], children: [{ _key: `xs${key}`, _type: 'span', text, marks: [] }], ...extra })

/** The tree as lines: text blocks by their text, containers by type, indented by depth. */
const outline = (nodes: unknown, depth = 0): string[] =>
  (Array.isArray(nodes) ? nodes : []).flatMap((n: Block) => {
    const pad = '  '.repeat(depth)
    if (n._type === 'block') return [`${pad}${(n.children ?? []).map(c => c.text).join('')}`]
    return [`${pad}<${n._type}>`, ...['content', 'rows', 'cells'].flatMap(f => (n[f] ? outline(n[f], depth + 1) : []))]
  })
const tree = async (page: Page) => outline(await blocksOf(page))

/** The text of every cell of the first table, row by row. */
const cells = async (page: Page) => {
  const find = (nodes: unknown): Block | undefined => {
    for (const n of (Array.isArray(nodes) ? nodes : []) as Block[]) {
      if (n._type === 'table') return n
      const inner = find(n.content)
      if (inner) return inner
    }
    return undefined
  }
  const table = find(await blocksOf(page))
  return ((table?.rows ?? []) as Block[]).map(r => ((r.cells ?? []) as Block[]).map(c => ((c.content ?? []) as Block[]).map(b => (b.children ?? []).map(s => s.text).join('')).join(' ')))
}

const tools   = (page: Page) => page.getByRole('button', { name: 'Tabellverktøy' })
const convert = (page: Page) => page.getByRole('button', { name: 'Gjør om til tabell', exact: true })
const panel   = (page: Page) => page.getByRole('group', { name: 'Gjør om til tabell' })

/** Select the first `lines` paragraphs of the editor. */
async function select(page: Page, lines: number) {
  await page.locator('.pt-editable p').nth(0).click()
  await settleSelection(page)
  for (let i = 1; i < lines; i++) await page.keyboard.press('Shift+ArrowDown')
  await settleSelection(page)
}

const tabs = [para('1', 'Nr\tNavn\tBy'), para('2', '1\tMartin\tOslo'), para('3', '2\tEva\tBergen'), para('4', 'Etter.')]

test.describe('turning lines into a table', () => {
  test('lines with tabs become a table: the tools button is on with lines selected, and the panel shows the table', async ({ page }) => {
    await openEditor(page, 'paragraph')
    await setFromOutside(page, tabs)
    await page.locator('.pt-editable p').nth(0).click()
    await settleSelection(page)
    await expect(tools(page)).toBeDisabled()          // a caret is not lines

    await select(page, 3)
    await expect(tools(page)).toBeEnabled()
    await tools(page).click()
    await expect(panel(page)).toBeVisible()
    await expect(panel(page)).toContainText('3 rader × 3 kolonner')
    await expect(page.getByRole('button', { name: 'Skilletegn tabulator' })).toHaveAttribute('aria-pressed', 'true')
    await convert(page).click()

    await expect.poll(() => cells(page)).toEqual([['Nr', 'Navn', 'By'], ['1', 'Martin', 'Oslo'], ['2', 'Eva', 'Bergen']])
    await expect.poll(async () => (await tree(page)).at(-1)).toBe('Etter.')
    await expect.poll(async () => (await tree(page))[0]).toBe('<table>')
    await expect(panel(page)).toHaveCount(0)
  })

  test('runs of spaces are guessed, and another separator can be picked, with the preview following', async ({ page }) => {
    await openEditor(page, 'paragraph')
    await setFromOutside(page, [para('1', 'Linge   Oslo; 1940'), para('2', 'Eva   Bergen; 1941'), para('3', 'Etter.')])
    await select(page, 2)
    await tools(page).click()
    await expect(page.getByRole('button', { name: 'Skilletegn 2+ mellomrom' })).toHaveAttribute('aria-pressed', 'true')
    await expect(panel(page)).toContainText('2 rader × 2 kolonner')

    await page.getByRole('button', { name: 'Skilletegn semikolon' }).click()
    await expect(panel(page)).toContainText('2 rader × 2 kolonner')
    await expect(page.locator('.pt-conv-preview td').first()).toHaveText('Linge   Oslo')
    await convert(page).click()
    await expect.poll(() => cells(page)).toEqual([['Linge   Oslo', '1940'], ['Eva   Bergen', '1941']])
  })

  test('the first line can be a header: bold, and only the first row', async ({ page }) => {
    await openEditor(page, 'paragraph')
    await setFromOutside(page, tabs)
    await select(page, 3)
    await tools(page).click()
    await page.getByRole('button', { name: 'Første linje er overskrift' }).click()
    await expect(page.locator('.pt-conv-preview th')).toHaveCount(3)
    await convert(page).click()
    await expect.poll(() => cells(page)).toHaveLength(3)
    const marks = async (row: number) => {
      const table = (await blocksOf(page))[0]
      return (((table.rows as Block[])[row].cells as Block[])[0].content as Block[])[0].children!.map(c => c.marks)
    }
    expect(await marks(0)).toEqual([['strong']])
    expect(await marks(1)).toEqual([[]])
  })

  test('one paragraph with line breaks gives a row for each line', async ({ page }) => {
    await openEditor(page, 'paragraph')
    await setFromOutside(page, [para('1', 'a\tb\nc\td\ne\tf'), para('2', 'Etter.')])
    await page.locator('.pt-editable p').nth(0).click()
    await settleSelection(page)
    await page.keyboard.press('Shift+End')
    await page.keyboard.press('Control+Shift+ArrowDown')
    await settleSelection(page)
    await tools(page).click()
    await expect(panel(page)).toContainText('3 rader × 2 kolonner')
    await convert(page).click()
    await expect.poll(() => cells(page)).toEqual([['a', 'b'], ['c', 'd'], ['e', 'f']])
  })

  test('is one undo step, and the lines come back as they were', async ({ page }) => {
    await openEditor(page, 'paragraph')
    await setFromOutside(page, tabs)
    const before = await tree(page)
    await select(page, 3)
    await tools(page).click()
    await convert(page).click()
    await expect.poll(async () => (await tree(page))[0]).toBe('<table>')
    await undo(page)
    await expect.poll(() => tree(page)).toEqual(before)
  })

  test('the caret goes into the first cell, so typing carries on there', async ({ page }) => {
    await openEditor(page, 'paragraph')
    await setFromOutside(page, tabs)
    await select(page, 3)
    await tools(page).click()
    await convert(page).click()
    await expect.poll(async () => (await tree(page))[0]).toBe('<table>')
    await settleSelection(page)
    await page.keyboard.type('!')
    await expect.poll(() => cells(page).then(c => c[0][0])).toBe('!Nr')
  })

  test('works on lines inside a box, and puts the table in the box', async ({ page }) => {
    await openEditor(page, 'paragraph')
    const box = { _key: 'bx', _type: 'infoBox', content: [para('1', 'a\tb'), para('2', 'c\td'), para('3', 'rest')] } as unknown as Block
    await setFromOutside(page, [para('0', 'Før.'), box])
    await page.locator('.pt-editable .pt-edit-box p').nth(0).click()
    await settleSelection(page)
    await page.keyboard.press('Shift+ArrowDown')
    await settleSelection(page)
    await tools(page).click()
    await convert(page).click()
    await expect.poll(async () => (await tree(page)).slice(0, 3)).toEqual(['Før.', '<infoBox>', '  <table>'])
    await expect.poll(() => cells(page)).toEqual([['a', 'b'], ['c', 'd']])
    await expect.poll(async () => (await tree(page)).at(-1)).toBe('  rest')
  })

  test('is off for a selection in a list, in a cell, and with a table in it, and for a caret alone', async ({ page }) => {
    await openEditor(page, 'paragraph')
    await setFromOutside(page, [para('1', 'a\tb', { listItem: 'bullet', level: 1 }), para('2', 'c\td', { listItem: 'bullet', level: 1 }), para('3', 'Etter.')])
    await select(page, 2)
    await expect(tools(page)).toBeDisabled()

    await openEditor(page, 'containers')
    await page.locator('.pt-editable .pt-edit-cell').nth(0).click()
    await settleSelection(page)
    await page.keyboard.press('Shift+End')
    await settleSelection(page)
    await tools(page).click()
    await expect(panel(page)).toHaveCount(0)          // in a table the tools open, not the converter
    await expect(page.getByRole('group', { name: 'Tabellverktøy' })).toBeVisible()
  })

  test('turns an old fixed-width table, padded with spaces of any width, into a table', async ({ page }) => {
    await openEditor(page, 'paragraph')
    const pre = (k: string, text: string) => para(k, text, { style: 'preformatted' })
    await setFromOutside(page, [pre('1', 'Nr  Navn            By'), pre('2', '1   Martin Linge    Oslo'), pre('3', '12  Eva              Bergen'), para('4', 'Etter.')])
    await page.locator('.pt-editable pre').nth(0).click()
    await settleSelection(page)
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Shift+ArrowDown')
    await settleSelection(page)
    await tools(page).click()
    await expect(page.getByRole('button', { name: 'Skilletegn 2+ mellomrom' })).toHaveAttribute('aria-pressed', 'true')
    await convert(page).click()
    await expect.poll(() => cells(page)).toEqual([['Nr', 'Navn', 'By'], ['1', 'Martin Linge', 'Oslo'], ['12', 'Eva', 'Bergen']])
    await expect(page.locator('.pt-editable pre')).toHaveCount(0)
  })

  test('says what to do when it is off', async ({ page }) => {
    await openEditor(page, 'paragraph')
    await expect(tools(page)).toHaveAttribute('title', /merk linjer som skal bli en tabell/)
  })
})
