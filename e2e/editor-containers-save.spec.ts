import { expect, test, type Page } from '@playwright/test'
import { caretAtEndOf, settleSelection } from './helpers/editor.ts'
import type { Block } from './harness/types.ts'

// A box and a table through the real DescriptionEditor, with its save bar, its checks and its PATCH (#312, #314):
// what Lagre sends keeps the containers, and a heading in a table cell stops the save, says why and offers the repair.
// The PATCH is answered by a stub and its body read (e2e/harness/description.html).
test.describe('saving a description with a box and a table', () => {
  /** The tree of the first section in a PATCH body: containers by type, text blocks by style and text, indented by depth. */
  const outline = (nodes: unknown, depth = 0): string[] =>
    (Array.isArray(nodes) ? nodes : []).flatMap((n: Block) => {
      const pad = '  '.repeat(depth)
      if (n._type === 'block') return [`${pad}${n.style ?? ''}: ${(n.children ?? []).map(c => c.text).join('')}`]
      return [`${pad}<${n._type}>`, ...['content', 'rows', 'cells'].flatMap(f => (n[f] ? outline(n[f], depth + 1) : []))]
    })

  async function open(page: Page, fixture: string) {
    const sent: unknown[] = []
    await page.route('**/__harness/description', async route => {
      sent.push(JSON.parse(route.request().postData() ?? '{}'))
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })
    await page.goto(`/e2e/harness/description.html?fixture=${fixture}`)
    await expect(page.locator('.pt-editable')).toBeVisible()
    const treeOf = (body: unknown) => outline(JSON.parse((body as { sections: { content: string }[] }).sections[0].content))
    return { sent, lastTree: () => treeOf(sent.at(-1)) }
  }
  const lagre = (page: Page) => page.getByRole('button', { name: 'Lagre' })

  test('Lagre sends the box and the table as they are, with the change that was made', async ({ page }) => {
    const { sent, lastTree } = await open(page, 'containers')
    await caretAtEndOf(page, 'Før boksen.')
    await settleSelection(page)
    await page.keyboard.type('!')
    await expect(lagre(page)).toBeVisible()
    await page.waitForTimeout(600)
    await lagre(page).click()
    await expect.poll(() => sent.length).toBe(1)
    expect(lastTree()).toEqual([
      'normal: Før boksen.!',
      '<infoBox>', '  normal: I boksen.', '  <table>', '    <row>', '      <cell>', '        normal: A1', '      <cell>', '        normal: B1',
      '<table>', '  <row>', '    <cell>', '      normal: CON', '      normal: PAK', '    <cell>', '      normal: 16',
      'normal: Etter tabellen.',
    ])
  })

  test('a table made in the editor, with its options, is what Lagre sends', async ({ page }) => {
    const { sent } = await open(page, 'paragraph')
    await caretAtEndOf(page, 'Første avsnitt.')
    await settleSelection(page)
    await page.getByRole('button', { name: 'Tabell med celler' }).click()
    await settleSelection(page)
    await page.keyboard.type('A')
    await page.getByRole('button', { name: 'Tabellverktøy' }).click()
    await page.getByRole('button', { name: 'Ramme rundt' }).click()
    await page.getByRole('button', { name: 'Linjer mellom kolonner' }).click()
    await page.keyboard.press('Escape')
    await expect(lagre(page)).toBeVisible()
    await page.waitForTimeout(600)
    await lagre(page).click()
    await expect.poll(() => sent.length).toBe(1)
    const blocks = JSON.parse((sent[0] as { sections: { content: string }[] }).sections[0].content) as Record<string, unknown>[]
    const t = blocks.find(b => b._type === 'table') as { frame?: string; rowLines?: boolean; columnLines?: boolean; rows: unknown[] }
    expect([t.frame, t.rowLines, t.columnLines, t.rows.length]).toEqual(['around', undefined, true, 2])
  })

  test('a heading in a table cell stops the save before any request, says why, and the repair makes it a paragraph', async ({ page }) => {
    const { sent, lastTree } = await open(page, 'cellHeading')
    await caretAtEndOf(page, 'Bakgrunn')
    await settleSelection(page)
    await page.keyboard.type('s')                                   // a change, so the save bar has something to save
    await expect(lagre(page)).toBeVisible()
    await page.waitForTimeout(600)
    await lagre(page).click()
    const issues = page.locator('.edit-link-issues-list li')
    await expect(issues).toHaveCount(1)
    await expect(issues.first()).toContainText('står i en tabellcelle')
    expect(sent).toHaveLength(0)

    await page.getByRole('button', { name: 'Gjør om til vanlig tekst' }).click()
    await expect(issues).toHaveCount(0)
    await lagre(page).click()
    await expect.poll(() => sent.length).toBe(1)
    expect(lastTree()).toEqual([
      'h3: Bakgrunns', '<table>', '  <row>', '    <cell>', '      normal: Celle med overskrift', '    <cell>', '      normal: Vanlig celle',
    ])
  })
})
