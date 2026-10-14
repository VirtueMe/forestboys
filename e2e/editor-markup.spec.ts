import { expect, test } from '@playwright/test'
import { openEditor } from './helpers/editor.ts'

// What the editor draws for each style, mark and list item. The other editor tests look at the value the editor
// reports; these look at the elements on the screen, which the CSS in PortableTextEditor.vue is written against.
test.describe('what the editor draws', () => {
  test('headings are h3 to h6, and a paragraph is a p', async ({ page }) => {
    await openEditor(page, 'headings')
    const editable = page.locator('.pt-editable')
    await expect(editable.locator('h3')).toHaveText('Bakgrunn')
    await expect(editable.locator('h4')).toHaveText('Detaljer')
    await expect(editable.locator('p')).toHaveText('Tekst under overskriftene.')
  })

  test('preformatted text is a pre in a monospace box', async ({ page }) => {
    await openEditor(page, 'marks')
    const pre = page.locator('.pt-editable pre')
    await expect(pre).toContainText('1.  Første')
    await expect(pre).toHaveCSS('font-family', /Courier/)
  })

  test('a quote is a blockquote', async ({ page }) => {
    await openEditor(page, 'marks')
    await expect(page.locator('.pt-editable blockquote')).toHaveText('Et sitat.')
  })

  test('bold, italic and underline are strong, em and u', async ({ page }) => {
    await openEditor(page, 'links')
    await expect(page.locator('.pt-editable strong')).toHaveText('noe fet tekst')
    await openEditor(page, 'marks')
    await expect(page.locator('.pt-editable em')).toHaveText('kursiv')
    await expect(page.locator('.pt-editable u')).toHaveText('understrek')
  })

  test('a link is an a.pt-link-mark, a link with no address is marked dead, and a person is an a.pt-person-mark', async ({ page }) => {
    await openEditor(page, 'links')
    const link = page.locator('.pt-editable a.pt-link-mark')
    await expect(link).toHaveText('det første møtet')
    await expect(link).toHaveAttribute('href', '/events/forste-mote-om-mostandsbevegelse-i-london')
    await expect(link).not.toHaveClass(/pt-link-mark--dead/)
    const person = page.locator('.pt-editable a.pt-person-mark')
    await expect(person).toHaveText('Bernt Balchen')
    await expect(person).toHaveAttribute('data-slug', 'bernt-balchen')
    await expect(person).toHaveAttribute('href', '/person/bernt-balchen')

    await openEditor(page, 'marks')
    await expect(page.locator('.pt-editable a.pt-link-mark--dead')).toHaveText('død lenke')
  })

  test('a link is not followed while editing', async ({ page }) => {
    await openEditor(page, 'links')
    const before = page.url()
    await page.locator('.pt-editable a.pt-link-mark').click()
    expect(page.url()).toBe(before)
  })

  test('a list item keeps the engine\'s wrapper (kind, level, number) with a paragraph inside, which the list CSS draws', async ({ page }) => {
    await openEditor(page, 'lists')
    const items = page.locator('.pt-editable [data-list-item]')
    await expect(items).toHaveCount(4)
    await expect(items.nth(0)).toHaveAttribute('data-list-item', 'bullet')
    await expect(items.nth(0)).toHaveAttribute('data-level', '1')
    await expect(items.nth(2)).toHaveAttribute('data-level', '2')
    await expect(items.nth(3)).toHaveAttribute('data-list-item', 'number')
    await expect(items.nth(3)).toHaveAttribute('data-list-index', '1')
    await expect(items.nth(0).locator('p')).toHaveText('Første punkt')
    // and the bullet is drawn: the ::before the CSS gives it
    expect(await items.nth(0).evaluate(el => getComputedStyle(el, '::before').content)).toContain('•')
  })
})
