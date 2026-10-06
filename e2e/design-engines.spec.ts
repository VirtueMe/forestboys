import { expect, test } from '@playwright/test'
import { judgeText } from '../src/utils/contrast.ts'
import { checkPageOutline } from '../src/utils/pageOutline.ts'
import { collectHeadings, collectTextSamples } from './helpers/collect.ts'

// The collectors of the design checks, tested against pages whose right verdicts are known (#139). If these
// fail, a verdict on a real page means nothing.
test.describe('the contrast collector and judge', () => {
  test('find exactly the failing, the passing, the unjudgeable and the skipped', async ({ page }) => {
    await page.goto('/e2e/harness/contrast.html')
    const samples = await collectTextSamples(page)
    const seen = samples.map(s => s.text)

    // skipped: not visible, disabled, svg. Never collected, so never reported either way.
    expect(seen.filter(t => t.startsWith('skipped-'))).toEqual([])

    const judged = judgeText(samples)
    const failing = judged.violations.flatMap(v => v.examples.map(e => e.replace(/ at .*/, '')))
    expect(failing.sort()).toEqual(['«bad-alpha-black»', '«bad-grey-on-white»', '«bad-inline-grey»', '«bad-opacity-half»', '«bad-placeholder»'])

    expect(judged.notJudged.map(n => [n.reason, n.examples.map(e => e.replace(/ at .*/, ''))])).toEqual([
      ['text over an image or a gradient', ['«notjudged-gradient»', '«notjudged-image»']],
    ])
    // passing: black on white, large grey, bold large grey, layered. And the bare `ok ` text node before the span.
    expect(seen.filter(t => t.startsWith('ok')).length).toBe(judged.passed)
  })

  test('report the numbers a person can check', async ({ page }) => {
    await page.goto('/e2e/harness/contrast.html')
    const { violations } = judgeText(await collectTextSamples(page))
    const grey = violations.find(v => v.fg === '#777777')!
    expect(grey).toMatchObject({ ratio: 4.48, required: 4.5, bg: '#FFFFFF', large: false, count: 2 })     // grey text, twice
    const alpha = violations.find(v => v.examples.some(e => e.includes('bad-alpha-black')))!
    expect(alpha.fg).toBe('#808080')                                                                          // 50% black on white
  })

  test('can be limited to part of the page', async ({ page }) => {
    await page.goto('/e2e/harness/contrast.html')
    const part = await collectTextSamples(page, 'div[style*="background: #222"]')
    expect(part.map(s => s.text)).toEqual(['ok-layered'])
  })

  test('leave out the development tooling that Vite and Vue add to every page', async ({ page }) => {
    await page.goto('/e2e/harness/contrast.html')
    // the page has a stand-in for the Vue devtools container, with text that would fail if it were judged
    await expect(page.locator('#__vue-devtools-container__ p').first()).toBeVisible()
    expect((await collectTextSamples(page)).map(s => s.text)).not.toContain('skipped-tooling')
  })
})

test.describe('the heading collector and the outline judge', () => {
  test('list the visible headings, with roles, and leave out the hidden ones', async ({ page }) => {
    await page.goto('/e2e/harness/outline.html')
    const headings = await collectHeadings(page)
    expect(headings.map(h => `h${h.level} ${h.text}`.trim())).toEqual(['h1 Side', 'h2 A', 'h4 for dypt', 'h3 rolle', 'h2'])
  })

  test('are judged: a skipped level and an empty heading', async ({ page }) => {
    await page.goto('/e2e/harness/outline.html')
    const problems = checkPageOutline(await collectHeadings(page))
    expect(problems.map(p => p.reason)).toEqual(['too-deep', 'empty'])
  })
})
