import { expect, test, type Page } from '@playwright/test'
import { blocksToHtml } from '../src/utils/portableText.ts'
import { openRecordedPage } from './helpers/replay.ts'
import { PAGES } from './pages.ts'

// The reading limit is on what is read, not on a table (#330): prose keeps --prose-max-width (68ch), while a table, a box and a
// fixed-width block may use the whole column the description sits in. Real blocksToHtml() output is put in the description of a
// replayed page, which is where the width is decided.

const span = (key: string, text: string) => ({ _key: `s${key}`, _type: 'span', text, marks: [] })
const para = (key: string, text: string) => ({ _key: `p${key}`, _type: 'block', style: 'normal', markDefs: [], children: [span(key, text)] })
const cell = (key: string, text: string) => ({ _key: `c${key}`, _type: 'cell', content: [para(`c${key}`, text)] })
const row = (key: string, n: number) => ({ _key: `r${key}`, _type: 'row', cells: Array.from({ length: n }, (_, i) => cell(`${key}${i}`, `Kolonne ${i + 1} med litt tekst`)) })
const table = (key: string, extra: Record<string, unknown> = {}) => ({ _key: `t${key}`, _type: 'table', rows: [row(`${key}a`, 8), row(`${key}b`, 8)], ...extra })
const long = 'En linje som er lang nok til å gå utenfor kolonnen på en telefon, og som aldri skal brytes av nettleseren. '.repeat(3)

const blocks = [
  para('1', 'Et avsnitt som skal ha leselengden sin, også når siden har god plass. '.repeat(6)),
  table('compact'),
  table('full', { width: 'full' }),
  { _key: 'box', _type: 'infoBox', content: [para('b1', 'I boksen.'), table('inbox', { width: 'full' })] },
  { _key: 'pre1', _type: 'block', style: 'preformatted', markDefs: [], children: [span('pre1', long)] },
  para('2', 'Et avsnitt til, etter tabellene.'),
]

/** The widths of the parts of the description, measured in the browser. */
async function measure(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector('.portable-text') as HTMLElement
    const w = (el: Element | null) => Math.round((el as HTMLElement).getBoundingClientRect().width)
    return {
      column: w(root.parentElement),
      paragraph: w(root.querySelector(':scope > p')),
      wrap: w(root.querySelector(':scope > .pt-table-wrap')),
      compact: w(root.querySelector(':scope > .pt-table-wrap table.pt-table:not(.pt-table--full)')),
      full: w(root.querySelector(':scope > .pt-table-wrap table.pt-table--full')),
      box: w(root.querySelector(':scope > .pt-box')),
      inBox: w(root.querySelector(':scope > .pt-box .pt-table-wrap')),
      pre: w(root.querySelector(':scope > pre.pre-table')),
      pageScroll: document.documentElement.scrollWidth - window.innerWidth,
    }
  })
}

const person = PAGES.find(p => p.kind === 'person')!

async function openWith(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 })
  await openRecordedPage(page, person)
  await page.locator('.portable-text').first().evaluate((el, html) => { el.innerHTML = html }, blocksToHtml(blocks))
}

test.describe('the reading limit and tables', () => {
  test('on a desktop window prose keeps its measure, and tables, boxes and fixed-width blocks use the whole column', async ({ page }) => {
    await openWith(page, 1440)
    const m = await measure(page)
    expect(m.column).toBeGreaterThan(1200)
    expect(m.paragraph).toBeLessThan(600)             // 68ch of the body face
    expect(m.paragraph).toBeGreaterThan(400)
    expect(m.wrap).toBeGreaterThanOrEqual(m.column - 2)
    expect(m.full).toBeGreaterThanOrEqual(m.column - 2)
    expect(m.compact).toBeLessThanOrEqual(m.column)
    expect(m.box).toBeGreaterThanOrEqual(m.column - 2)
    expect(m.inBox).toBeGreaterThanOrEqual(m.box - 40)  // the box's own padding
    expect(m.pre).toBeGreaterThanOrEqual(m.column - 2)
    expect(m.pageScroll).toBeLessThanOrEqual(0)
  })

  test('the paragraphs around a table keep their measure, and start where the table starts', async ({ page }) => {
    await openWith(page, 1440)
    const lefts = await page.evaluate(() => {
      const root = document.querySelector('.portable-text') as HTMLElement
      const left = (sel: string) => Math.round(root.querySelector(sel)!.getBoundingClientRect().left)
      return { p: left(':scope > p'), table: left(':scope > .pt-table-wrap'), last: left(':scope > p:last-of-type') }
    })
    expect(lefts.table).toBe(lefts.p)
    expect(lefts.last).toBe(lefts.p)
  })

  test('on a phone nothing is wider than the screen: a wide table and a long line scroll inside their own box', async ({ page }) => {
    await openWith(page, 390)
    const m = await measure(page)
    expect(m.column).toBeLessThanOrEqual(390)
    for (const part of [m.paragraph, m.wrap, m.box, m.pre]) expect(part).toBeLessThanOrEqual(m.column)
    expect(m.pageScroll).toBeLessThanOrEqual(0)
    const scrolls = await page.evaluate(() => {
      const root = document.querySelector('.portable-text') as HTMLElement
      const wider = (sel: string) => { const el = root.querySelector(sel) as HTMLElement; return el.scrollWidth > el.clientWidth }
      return { table: wider(':scope > .pt-table-wrap'), pre: wider(':scope > pre.pre-table') }
    })
    expect(scrolls).toEqual({ table: true, pre: true })
  })
})
