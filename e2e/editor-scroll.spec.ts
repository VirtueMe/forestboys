import { expect, test, type Page } from '@playwright/test'
import { openEditor } from './helpers/editor.ts'

// Where a scroll goes at phone width (#140). The inline box scrolls its own text, and when it is at the
// end the next swipe must carry on to the page, or a finger that lands on the box can never get past it.
// The full-window box is the opposite on purpose: the page behind it must not move (#123).
//
// Real touch input, from the browser's own input pipeline (CDP `Input.dispatchTouchEvent`), so scroll chaining
// is the browser's. `?scroller=1` puts the editor inside a scroll container as the app's page is
// (`.page-content`: the window itself never scrolls).
test.describe('scrolling at phone width', () => {
  test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true })

  type Scrollable = { scrollTop: number; scrollHeight: number; clientHeight: number }
  const positions = (page: Page) => page.evaluate(() => {
    const d = (globalThis as unknown as { document: { querySelector(s: string): Scrollable | null } }).document
    const box = d.querySelector('.pt-editable')!
    const scroller = d.querySelector('[data-testid=scroller]')!
    return { box: box.scrollTop, boxEnd: box.scrollHeight - box.clientHeight, page: scroller.scrollTop, pageEnd: scroller.scrollHeight - scroller.clientHeight }
  })

  /**
   * A finger drags up from the middle of the text box: a touch start, ten moves and a touch end, as real touch
   * input (CDP `Input.dispatchTouchEvent`), so scroll chaining is the browser's own. Not
   * `Input.synthesizeScrollGesture` with a touch source: on Linux's headless Chromium it scrolls nothing at all
   * (found on CI, reproduced in a Debian container), while on macOS it works.
   */
  const swipeUp = async (page: Page, distance = 500) => {
    const box = (await page.locator('.pt-editable').boundingBox())!
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    for (let step = 1; step <= 10; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - (distance * step) / 10 }] })
      await page.waitForTimeout(16)
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    // The swipe is over when the call returns; the scrolling it started (a fling) is still settling.
    await page.waitForTimeout(350)
  }

  /** Swipe until the text box is at its end (a pixel of rounding is allowed). */
  const swipeToEndOfBox = async (page: Page) => {
    for (let i = 0; i < 15; i++) {
      const p = await positions(page)
      if (p.box >= p.boxEnd - 2) return
      await swipeUp(page)
    }
    throw new Error(`the box never reached its end: ${JSON.stringify(await positions(page))}`)
  }

  test('a swipe over the box scrolls the text and leaves the page where it is', async ({ page }) => {
    await openEditor(page, 'long', { scroller: true })
    expect((await positions(page)).pageEnd).toBeGreaterThan(500)   // there is a page to scroll, or the test proves nothing
    await swipeUp(page)
    const after = await positions(page)
    expect(after.box).toBeGreaterThan(300)
    expect(after.page).toBe(0)
  })

  test('at the end of the box, the next swipe carries on to the page', async ({ page }) => {
    await openEditor(page, 'long', { scroller: true })
    await swipeToEndOfBox(page)
    expect((await positions(page)).page).toBe(0)                   // the page waited while the text had room
    await swipeUp(page)
    await expect.poll(async () => (await positions(page)).page).toBeGreaterThan(300)
  })

  // What this pins is the promise: the page behind the full window stays put. It does not pin the
  // `overscroll-behavior: contain` of the full-window rules: the host is `position: fixed`, which already
  // takes it out of the page's scroll chain, and the test still passes with `contain` removed (tried). What
  // `contain` does for the window itself (pull to refresh) is not something this can observe.
  test('in the full window, when the text has reached its end the page behind does not move', async ({ page }) => {
    await openEditor(page, 'long', { scroller: true })
    await page.getByRole('button', { name: 'Utvid' }).click()
    await expect(page.locator('.pt-editor-host--full')).toBeVisible()
    await swipeToEndOfBox(page)
    await swipeUp(page)
    await swipeUp(page)
    expect((await positions(page)).page).toBe(0)
  })
})
