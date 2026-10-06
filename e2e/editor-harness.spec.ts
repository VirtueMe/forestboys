import { expect, test } from '@playwright/test'
import { blocksOf, openEditor, reportedTexts, texts } from './helpers/editor.ts'

// The harness itself (#129): if these fail, no editor test below them means anything.
test.describe('the editor harness', () => {
  test('mounts the real editor with the fixture', async ({ page }) => {
    await openEditor(page, 'paragraph')
    await expect(page.locator('.pt-editable')).toContainText('Første avsnitt.')
    await expect(page.getByRole('button', { name: 'Lenke' })).toBeVisible()   // the real toolbar, not a stand-in
    expect(texts(await blocksOf(page))).toEqual(['Første avsnitt.'])
  })

  test('reports what is typed, with real keypresses', async ({ page }) => {
    await openEditor(page, 'paragraph')
    await page.locator('.pt-editable p').click()
    await page.keyboard.press('End')
    await page.keyboard.type(' Mer tekst.')
    await expect.poll(() => reportedTexts(page)).toEqual(['Første avsnitt. Mer tekst.'])
  })

  test('starts from an unknown fixture name with a clear error, not a blank page', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto('/e2e/harness/editor.html?fixture=finnes-ikke')
    await expect.poll(() => errors.join('\n')).toContain('No fixture «finnes-ikke»')
  })
})
