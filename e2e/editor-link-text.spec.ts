import { expect, test } from '@playwright/test'
import { blocksOf, caretAtEndOf, caretInside, findSpan, linkHref, openEditor, reportedTexts, settleSelection, undo } from './helpers/editor.ts'

const ADDRESS = '/events/forste-mote-om-mostandsbevegelse-i-london'

// The link box edits the words of a link as well as the address (#126).
test.describe('the link box and the link text', () => {
  const tekst = (page: import('@playwright/test').Page) => page.getByLabel('Tekst')
  const adresse = (page: import('@playwright/test').Page) => page.getByLabel('Adresse')
  const lenke = (page: import('@playwright/test').Page) => page.getByRole('button', { name: 'Lenke' })

  test('the Lenke button is disabled until the editor has a caret or a selection', async ({ page }) => {
    await openEditor(page, 'paragraph')
    await expect(lenke(page)).toBeDisabled()
    await caretAtEndOf(page, 'Første avsnitt.')
    await expect(lenke(page)).toBeEnabled()
  })

  test('selected words are prefilled, edited and linked, and one undo takes it back', async ({ page }) => {
    await openEditor(page, 'paragraph')
    await page.locator('.pt-editable').getByText('Første avsnitt.').dblclick({ position: { x: 10, y: 8 } })   // the first word
    await settleSelection(page)
    await lenke(page).click()
    await expect(tekst(page)).toHaveValue('Første')
    await expect(page.getByRole('button', { name: 'Bruk' })).toBeDisabled()    // no address yet

    await tekst(page).fill('Fyrste')
    await adresse(page).fill('/events/en-hendelse')
    await page.getByRole('button', { name: 'Bruk' }).click()
    await expect.poll(() => reportedTexts(page)).toEqual(['Fyrste avsnitt.'])
    const linked = findSpan(await blocksOf(page), 'Fyrste')!
    expect(linkHref(linked.block, linked.span)).toBe('/events/en-hendelse')

    await undo(page)
    await expect.poll(() => reportedTexts(page)).toEqual(['Første avsnitt.'])    // one step, not two
    expect(findSpan(await blocksOf(page), 'Fyrste')).toBeNull()
  })

  test('the words of an existing link are changed and the link and its address stay', async ({ page }) => {
    await openEditor(page, 'links')
    await caretInside(page, 'det første møtet')
    await expect(lenke(page)).toHaveClass(/active/)                      // the editor has the caret in the link
    await lenke(page).click()
    await expect(tekst(page)).toHaveValue('det første møtet')
    await expect(adresse(page)).toHaveValue(ADDRESS)

    await tekst(page).fill('det første møtet i London')
    await page.getByRole('button', { name: 'Endre' }).click()
    await expect.poll(async () => findSpan(await blocksOf(page), 'det første møtet i London') !== null).toBe(true)
    const linked = findSpan(await blocksOf(page), 'det første møtet i London')!
    expect(linkHref(linked.block, linked.span)).toBe(ADDRESS)

    await undo(page)
    await expect.poll(async () => findSpan(await blocksOf(page), 'det første møtet') !== null).toBe(true)
  })

  test('a link whose words are all bold keeps the bold and the link', async ({ page }) => {
    await openEditor(page, 'boldLink')
    await caretInside(page, 'det fete møtet')
    await expect(lenke(page)).toHaveClass(/active/)
    await lenke(page).click()
    await tekst(page).fill('det fete og nye møtet')
    await page.getByRole('button', { name: 'Endre' }).click()
    await expect.poll(async () => findSpan(await blocksOf(page), 'det fete og nye møtet') !== null).toBe(true)
    const { block, span } = findSpan(await blocksOf(page), 'det fete og nye møtet')!
    expect(span.marks).toContain('strong')
    expect(linkHref(block, span)).toBe(ADDRESS)
  })

  test('a link with mixed formatting has a read-only text, and its address can still change', async ({ page }) => {
    await openEditor(page, 'mixedLink')
    await caretInside(page, 'del')
    await expect(lenke(page)).toHaveClass(/active/)
    await lenke(page).click()
    await expect(tekst(page)).toHaveValue('del fet')
    await expect(tekst(page)).toHaveAttribute('readonly', '')
    await expect(adresse(page)).toBeEditable()

    await adresse(page).fill('/events/ny-adresse')
    await page.getByRole('button', { name: 'Endre' }).click()
    await expect.poll(async () => {
      const blocks = await blocksOf(page)
      const part = findSpan(blocks, 'del ')
      return part ? linkHref(part.block, part.span) : null
    }).toBe('/events/ny-adresse')
    expect(await reportedTexts(page)).toEqual(['Se del fet nå.'])           // the words and the bold are as they were
    const bold = findSpan(await blocksOf(page), 'fet')!
    expect(bold.span.marks).toContain('strong')
  })

  test('at a caret the box inserts new linked words, and one undo takes them away', async ({ page }) => {
    await openEditor(page, 'paragraph')
    await caretAtEndOf(page, 'Første avsnitt.')
    await lenke(page).click()
    await expect(page.getByRole('button', { name: 'Sett inn' })).toBeDisabled()

    await tekst(page).fill(' Se også Arkivet')
    await adresse(page).fill('/events/arkivet')
    await page.getByRole('button', { name: 'Sett inn' }).click()
    await expect.poll(() => reportedTexts(page)).toEqual(['Første avsnitt. Se også Arkivet'])
    const inserted = findSpan(await blocksOf(page), ' Se også Arkivet')!
    expect(linkHref(inserted.block, inserted.span)).toBe('/events/arkivet')

    await undo(page)
    await expect.poll(() => reportedTexts(page)).toEqual(['Første avsnitt.'])
  })
})
