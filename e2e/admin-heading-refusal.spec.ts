import { expect, test, type Page } from '@playwright/test'
import { caretAtEndOf, settleSelection } from './helpers/editor.ts'
import { openRecordedEditMode } from './helpers/replay.ts'
import { PAGES } from './pages.ts'

// A save that would break the heading rules is stopped before any request, names what is wrong, and offers
// the repair (#127), on the real page: a person's edit mode, rendered from its recording with the visitor
// answered as an admin (#140). The save itself is answered by a stub, and what it was sent is read.
const person = PAGES.find(p => p.kind === 'person')!

test.describe('the heading check on save, in the edit mode of a page', () => {
  /** Open the person in edit mode and record every PATCH (answered with success) instead of sending it. */
  async function open(page: Page) {
    const patches: { url: string; styles: (string | undefined)[] }[] = []
    const replay = await openRecordedEditMode(page, person)
    await page.route('**/api/**', route => {
      const request = route.request()
      if (request.method() !== 'PATCH') return route.fallback()
      const { sections } = request.postDataJSON() as { sections: { content: string }[] }
      expect(sections).toHaveLength(1)                          // the person has one section; the styles below are read from it
      patches.push({ url: new URL(request.url()).pathname, styles: (JSON.parse(sections[0].content) as { style?: string }[]).map(b => b.style) })
      return route.fulfill({ json: {} })
    })
    await precondition(page)
    return { patches, replay }
  }

  const editor = (page: Page) => page.locator('.pt-editable').first()
  const blockStyles = (page: Page, count: number) => editor(page).locator('> *').evaluateAll(
    (els, n) => els.slice(0, n).map(e => e.querySelector('h3, h4, h5, h6')?.tagName ?? 'P'), count,
  )
  const lagre = (page: Page) => page.getByRole('button', { name: 'Lagre' })
  const issues = (page: Page) => page.locator('.edit-link-issues-list li')

  /** Give the block that contains `text` the level, from the ▾ menu (H4 to H6) as the author does. */
  async function setLevel(page: Page, text: string, level: 'H4' | 'H5' | 'H6') {
    await caretAtEndOf(page, text)
    await settleSelection(page)
    await page.getByRole('button', { name: 'Flere overskriftsnivåer' }).click()
    await page.getByRole('button', { name: level, exact: true }).click()
    await expect(page.getByRole('button', { name: 'Flere overskriftsnivåer' })).toHaveClass(/active/)   // the editor has it
  }

  // Two paragraphs of the description as it was when the page was recorded. They must be single-line (the caret
  // is put at the end of a line), so a re-recording after the description was edited can break this: the
  // precondition below says so, instead of the caret failing to arrive somewhere else.
  const FIRST = 'Norsk amerikansk flyger'          // the first paragraph
  const SHORT = 'Veteran of:'                      // a short paragraph further down
  const precondition = async (page: Page) => {
    const why = 'the recorded description changed: update FIRST and SHORT in this spec, they must be single-line paragraphs'
    await expect(editor(page), why).toContainText(FIRST)
    await expect(editor(page), why).toContainText(SHORT)
  }

  test('an H5 straight under the section is refused: no request, the problem named, the repair offered', async ({ page }) => {
    const { patches, replay } = await open(page)
    expect(replay.misses()).toEqual([])
    await setLevel(page, FIRST, 'H5')
    await lagre(page).click()

    await expect(page.locator('.edit-save-error')).toContainText('Noen overskrifter følger ikke strukturen')
    await expect(issues(page)).toHaveCount(1)
    await expect(issues(page).first()).toContainText('er H5, men kan være høyst H3 her')
    await expect(page.getByRole('button', { name: 'Bruk H3' })).toBeVisible()
    expect(patches).toEqual([])
  })

  test('«Bruk H3» repairs it, and the next Lagre saves the repaired heading', async ({ page }) => {
    const { patches } = await open(page)
    await setLevel(page, FIRST, 'H5')
    await lagre(page).click()
    await page.getByRole('button', { name: 'Bruk H3' }).click()
    await expect(issues(page)).toHaveCount(0)
    await expect.poll(() => blockStyles(page, 1)).toEqual(['H3'])

    await lagre(page).click()
    await expect.poll(() => patches.length).toBe(1)
    expect(patches[0].url).toBe('/api/admin/person/bernt-balchen/sections')
    expect(patches[0].styles[0]).toBe('h3')
    expect(patches[0].styles).not.toContain('h5')
  })

  test('«Angre» throws the draft away: the heading is a paragraph again, and nothing was sent', async ({ page }) => {
    const { patches } = await open(page)
    await setLevel(page, FIRST, 'H5')
    await lagre(page).click()
    await expect(issues(page)).toHaveCount(1)

    await page.getByRole('button', { name: 'Angre' }).click()
    await expect(issues(page)).toHaveCount(0)
    await expect(lagre(page)).toHaveCount(0)                       // no draft left to save
    await expect.poll(() => blockStyles(page, 1)).toEqual(['P'])
    expect(patches).toEqual([])
  })

  test('«Rett opp alle» repairs every problem at once, and the next Lagre saves them', async ({ page }) => {
    const { patches } = await open(page)
    await setLevel(page, FIRST, 'H4')                              // too deep under the section: H3 at most
    await setLevel(page, SHORT, 'H6')                              // too deep after an H4: H5 at most
    await lagre(page).click()
    await expect(issues(page)).toHaveCount(2)

    await page.getByRole('button', { name: 'Rett opp alle' }).click()
    await expect(issues(page)).toHaveCount(0)

    await lagre(page).click()
    await expect.poll(() => patches.length).toBe(1)
    const headings = patches[0].styles.filter(s => s?.startsWith('h'))
    expect(headings).toEqual(['h3', 'h4'])                         // a clean outline, one level at a time
  })
})
