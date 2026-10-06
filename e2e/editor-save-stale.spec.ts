import { expect, test, type Page } from '@playwright/test'
import { caretAtEndOf, undo } from './helpers/editor.ts'

// What Lagre sends, when it is pressed right after a change (#140, fixed in #145). The editor reports a
// change to the page about 0.3 s after typing and about 1 s after an undo, and Lagre used to send what
// the page last heard: a Lagre within a second of an undo saved the text from before it, and one within
// 0.1 s of typing missed the last word. Lagre now asks every editor for what it holds before it sends
// (`flush`), so the two tests below hold at any delay.
//
// The real DescriptionEditor with its real save bar and PATCH (e2e/harness/description.html); the PATCH is
// answered by a stub and its body read.
test.describe('Lagre right after a change', () => {
  /** The text of each section in a PATCH body. */
  const textsOf = (body: string) => (JSON.parse(body).sections as { content: string }[]).map(
    s => (JSON.parse(s.content) as { children: { text: string }[] }[]).map(b => b.children.map(c => c.text).join('')).join('|'),
  )

  /** Open the harness with «Første avsnitt.», the caret at its end, and the PATCH answered and recorded. */
  async function open(page: Page) {
    const sent: string[] = []
    await page.route('**/__harness/description', async route => {
      sent.push(route.request().postData() ?? '')
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })
    await page.goto('/e2e/harness/description.html')
    await expect(page.locator('.pt-editable')).toBeVisible()
    await caretAtEndOf(page, 'Første avsnitt.')
    await page.waitForTimeout(250)                                 // the editor has the selection (it takes it over after ~100 ms)
    return { sent: () => sent.map(textsOf) }
  }

  const lagre = (page: Page) => page.getByRole('button', { name: 'Lagre' })

  test('control: a Lagre pressed once the change has been reported saves what was typed', async ({ page }) => {
    const { sent } = await open(page)
    await page.keyboard.type(' Mer')
    await expect(lagre(page)).toBeVisible()                        // the page has heard of the change
    await page.waitForTimeout(600)                                 // typing is reported after ~0.3 s; nothing observable says when
    await lagre(page).click()
    await expect.poll(sent).toEqual([['Første avsnitt. Mer']])
  })

  test('Lagre right after an undo saves the text on the screen (#145)', async ({ page }) => {
    const { sent } = await open(page)
    await page.keyboard.type(' Mer tekst.')
    await expect(lagre(page)).toBeVisible()
    await page.waitForTimeout(600)                                 // typing is reported; only the undo is still on its way
    await undo(page)                                               // the screen now shows «Første avsnitt. Mer»
    await lagre(page).click()
    await expect.poll(() => sent().length).toBe(1)
    expect(sent()).toEqual([['Første avsnitt. Mer']])
  })

  test('Lagre right after typing saves the last word (#145)', async ({ page }) => {
    const { sent } = await open(page)
    await page.keyboard.type(' Tekst')
    await expect(lagre(page)).toBeVisible()
    await page.keyboard.type(' mer')
    await lagre(page).click()
    await expect.poll(() => sent().length).toBe(1)
    expect(sent()).toEqual([['Første avsnitt. Tekst mer']])
  })
})
