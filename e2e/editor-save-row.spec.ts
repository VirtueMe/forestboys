import { expect, test, type Page } from '@playwright/test'
import { caretAtEndOf, settleSelection } from './helpers/editor.ts'
import { openRecordedEditMode } from './helpers/replay.ts'
import { PAGES } from './pages.ts'

// The save row (#427): one row for the page, with a line per section that has unsaved changes. On a person's edit
// mode, rendered from its recording and answered as an admin (#140), with three sections edited: «Grunnleggende»,
// «Beskrivelse» and «Grad». The saves are answered by a stub, and what it was sent, and in which order, is read.
const person = PAGES.find(p => p.kind === 'person')!
const API = `/api/admin/person/${person.slug}`
/** The endpoint each section saves to. */
const ENDPOINT = { Grunnleggende: API, Beskrivelse: `${API}/sections`, Grad: `${API}/rank` } as const
type Section = keyof typeof ENDPOINT

// A single-line paragraph of the description as it was when the page was recorded (see admin-heading-refusal.spec.ts).
const FIRST = 'Norsk amerikansk flyger'

interface Saves {
  /** Every PATCH the page sent, in order. */
  calls: string[]
  /** The most saves that were in flight at once: the row saves one section at a time. */
  maxInFlight(): number
  /** Endpoints that answer with an error, and the message the server gives. */
  failing: Map<string, string>
}

async function open(page: Page): Promise<Saves> {
  await openRecordedEditMode(page, person)
  const saves: Saves = { calls: [], maxInFlight: () => max, failing: new Map() }
  let inFlight = 0
  let max = 0
  await page.route('**/api/admin/**', async route => {
    const request = route.request()
    if (request.method() !== 'PATCH') return route.fallback()
    const path = new URL(request.url()).pathname
    saves.calls.push(path)
    inFlight++; max = Math.max(max, inFlight)
    await new Promise(resolve => setTimeout(resolve, 60))     // long enough for two saves to overlap if they were not in sequence
    inFlight--
    const message = saves.failing.get(path)
    return message ? route.fulfill({ status: 500, json: { error: message } }) : route.fulfill({ json: {} })
  })
  return saves
}

const row     = (page: Page) => page.getByTestId('save-row')
const summary = (page: Page) => row(page).locator('.save-summary-text')           // the text, without the chevron
const toggle  = (page: Page) => row(page).getByRole('button', { name: /seksjon/ })   // the button that opens the drop-up
const lagreAlt = (page: Page) => row(page).getByRole('button', { name: 'Lagre alt' })
const item    = (page: Page, label: Section) => page.locator('.save-item', { hasText: label })
const rank    = (page: Page) => page.getByLabel('Grad', { exact: true })

async function editName(page: Page) { await page.locator('#edit-secretName').fill('Testnavn') }
async function editRank(page: Page) { await rank(page).selectOption('menig') }
async function editDescription(page: Page) {
  await caretAtEndOf(page, FIRST)
  await settleSelection(page)
  await page.keyboard.type(' (rettet)')
}
async function editAllThree(page: Page) {
  await editName(page)
  await editDescription(page)
  await editRank(page)
}
/** The labels in the drop-up, in the order the row lists (and saves) them. */
const listed = (page: Page) => page.locator('.save-item-label').allInnerTexts() as Promise<Section[]>

test.describe('the save row, in the edit mode of a page', () => {
  test('nothing is unsaved: there is no row', async ({ page }) => {
    await open(page)
    await expect(row(page)).toHaveCount(0)
    await expect(page.locator('.edit-save-bar')).toHaveCount(0)
  })

  test('three sections edited: one row counts them, the drop-up names them, and no section has its own bar', async ({ page }) => {
    await open(page)
    await editName(page)
    await expect(summary(page)).toHaveText('1 seksjon har ulagrede endringer')
    await editDescription(page)
    await editRank(page)
    await expect(summary(page)).toHaveText('3 seksjoner har ulagrede endringer')
    await expect(page.locator('.edit-save-bar')).toHaveCount(0)

    await toggle(page).click()
    expect((await listed(page)).sort()).toEqual(['Beskrivelse', 'Grunnleggende', 'Grad'].sort())
  })

  test('«Lagre alt» saves each section once, one at a time, and then says everything is saved', async ({ page }) => {
    const saves = await open(page)
    await editAllThree(page)
    await expect(summary(page)).toHaveText('3 seksjoner har ulagrede endringer')
    await toggle(page).click()
    const order = await listed(page)

    await lagreAlt(page).click()
    await expect(row(page)).toContainText('Alt er lagret')
    expect(saves.calls).toEqual(order.map(label => ENDPOINT[label]))     // in the order the row lists them
    expect(saves.maxInFlight()).toBe(1)
    await expect(row(page)).toHaveCount(0)                               // and then the row has nothing to show
  })

  test('a failure in the middle does not stop the rest; the server\'s message is shown; «Prøv igjen» saves just that section', async ({ page }) => {
    const saves = await open(page)
    saves.failing.set(ENDPOINT.Beskrivelse, 'Beskrivelsen ble ikke lagret')
    await editAllThree(page)

    await lagreAlt(page).click()
    await expect(summary(page)).toHaveText('1 seksjon kunne ikke lagres')
    expect(saves.calls.slice().sort()).toEqual(Object.values(ENDPOINT).sort())   // all three were tried, once each
    await expect(item(page, 'Beskrivelse')).toContainText('Kunne ikke lagres')
    await expect(item(page, 'Beskrivelse').locator('.save-item-error')).toHaveText('Beskrivelsen ble ikke lagret')
    await expect(item(page, 'Grunnleggende')).toContainText('Lagret')
    await expect(item(page, 'Grad')).toContainText('Lagret')

    saves.failing.clear()
    saves.calls.length = 0
    await item(page, 'Beskrivelse').getByRole('button', { name: 'Prøv igjen' }).click()
    await expect(row(page)).toContainText('Alt er lagret')
    expect(saves.calls).toEqual([ENDPOINT.Beskrivelse])
  })

  test('typing in the description and pressing «Lagre alt» at once still saves it, though the editor reports a moment late', async ({ page }) => {
    const saves = await open(page)
    await editName(page)                                  // the row is there, for another section
    await editDescription(page)
    await lagreAlt(page).click()                          // straight away: the description may not have said it changed
    await expect(row(page)).toContainText('Alt er lagret')
    expect(saves.calls.slice().sort()).toEqual([ENDPOINT.Beskrivelse, ENDPOINT.Grunnleggende].sort())
  })

  test('«Angre» in the drop-up reverts one section and leaves the others as they are', async ({ page }) => {
    const saves = await open(page)
    const before = await rank(page).inputValue()
    await editName(page)
    await editRank(page)
    await toggle(page).click()
    await expect(summary(page)).toHaveText('2 seksjoner har ulagrede endringer')

    await item(page, 'Grad').getByRole('button', { name: 'Angre' }).click()
    await expect(rank(page)).toHaveValue(before)
    await expect(page.locator('#edit-secretName')).toHaveValue('Testnavn')
    await expect(summary(page)).toHaveText('1 seksjon har ulagrede endringer')
    expect(saves.calls).toEqual([])
  })

  test('a failed section is unsaved again as soon as it is edited, not a failure that has already been dealt with', async ({ page }) => {
    const saves = await open(page)
    saves.failing.set(ENDPOINT.Grad, 'Graden kunne ikke settes')
    await editRank(page)
    await lagreAlt(page).click()
    await expect(summary(page)).toHaveText('1 seksjon kunne ikke lagres')

    await rank(page).selectOption('korporal')
    await expect(summary(page)).toHaveText('1 seksjon har ulagrede endringer')
    await expect(row(page).locator('.save-item-error')).toHaveCount(0)
  })
})

test.describe('leaving a page with unsaved sections', () => {
  /** Navigate inside the app, as a link does; resolves to the path the page is on afterwards (a cancelled navigation resolves too). */
  const goTo = (page: Page, to: string) => page.evaluate(
    t => (document.querySelector('#app') as unknown as { __vue_app__: { config: { globalProperties: { $router: { push(to: string): Promise<unknown> } } } } })
      .__vue_app__.config.globalProperties.$router.push(t).then(() => location.pathname),
    to,
  )

  test('another page asks first and names the sections; no keeps the edits, yes leaves', async ({ page }) => {
    await open(page)
    await editName(page)
    await editRank(page)
    const messages: string[] = []
    let answer = false
    page.on('dialog', dialog => { messages.push(dialog.message()); return answer ? dialog.accept() : dialog.dismiss() })

    expect(await goTo(page, '/person/someone-else')).toBe(person.path)           // the navigation was cancelled: still here
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('Grunnleggende')
    expect(messages[0]).toContain('Grad')
    expect(messages[0]).toContain('Forlate siden')
    expect(new URL(page.url()).pathname).toBe(person.path)
    await expect(page.locator('#edit-secretName')).toHaveValue('Testnavn')      // nothing lost

    answer = true
    await goTo(page, '/person/someone-else')
    expect(new URL(page.url()).pathname).toBe('/person/someone-else')
    expect(messages).toHaveLength(2)
  })

  test('nothing unsaved: nothing is asked', async ({ page }) => {
    await open(page)
    const messages: string[] = []
    page.on('dialog', dialog => { messages.push(dialog.message()); return dialog.dismiss() })
    await goTo(page, '/person/someone-else')
    expect(new URL(page.url()).pathname).toBe('/person/someone-else')
    expect(messages).toEqual([])
  })

  test('another part of the same person (:child) is not leaving', async ({ page }) => {
    await open(page)
    await editName(page)
    const messages: string[] = []
    page.on('dialog', dialog => { messages.push(dialog.message()); return dialog.dismiss() })
    await goTo(page, `${person.path}/foo`)
    expect(messages).toEqual([])
  })

  test('reloading or closing the tab gets the browser\'s own prompt, and only while something is unsaved', async ({ page }) => {
    await open(page)
    const types: string[] = []
    page.on('dialog', dialog => { types.push(dialog.type()); return dialog.dismiss() })

    await page.evaluate(() => { document.body.click() })                 // a page needs a gesture before the browser asks
    await editName(page)
    await page.reload({ timeout: 3000 }).catch(() => { /* the prompt was dismissed: the page stays */ })
    expect(types).toEqual(['beforeunload'])
  })
})
