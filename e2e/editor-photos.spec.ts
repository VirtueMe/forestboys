import { expect, test } from '@playwright/test'

// The photo editor (#414): add, caption, hero, move and remove a photo of an entity, a long list as a scroll view of its
// first 4 rows, and what happens when a save fails. The page talks to a fake of /api/admin/<kind>/<slug>/images.

type Page = import('@playwright/test').Page
interface Img { id: string, url: string, caption: string | null, isHero: boolean, order: number }

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

/** The server's side: the list, and what each request does to it. `failNext` makes the next write answer 500. */
async function serve(page: Page, n = 0) {
  const server = {
    list: Array.from({ length: n }, (_, i): Img => ({ id: `img:upload:${i + 1}`, url: `/fake/${i + 1}`, caption: null, isHero: i === 0, order: i + 1 })),
    failNext: false,
    writes: 0,
  }
  const sorted = () => [...server.list].sort((a, b) => a.order - b.order)
  await page.route('**/fake/**', route => route.fulfill({ body: PNG, contentType: 'image/png' }))
  await page.route('**/api/neo4j/query', route => route.fulfill({ json: { rows: [] } }))
  await page.route('**/api/admin/person/harness/images', async route => {
    const req = route.request()
    const method = req.method()
    if (method !== 'GET') {
      server.writes++
      if (server.failNext) { server.failNext = false; return route.fulfill({ status: 500, json: { error: 'Grafen svarte ikke' } }) }
    }
    if (method === 'POST') {
      const id = server.list.length + 1
      server.list.push({ id: `img:upload:${id}`, url: `/fake/${id}`, caption: null, isHero: server.list.length === 0, order: id })
    } else if (method === 'PATCH') {
      const body = req.postDataJSON() as { order?: string[], hero?: string | null, captions?: Record<string, string | null> }
      body.order?.forEach((id, i) => { server.list.find(x => x.id === id)!.order = i + 1 })
      if (body.hero !== undefined) server.list.forEach(x => { x.isHero = x.id === body.hero })
      for (const [id, c] of Object.entries(body.captions ?? {})) server.list.find(x => x.id === id)!.caption = c
    } else if (method === 'DELETE') {
      const { id } = req.postDataJSON() as { id: string }
      server.list = server.list.filter(x => x.id !== id)
    }
    return route.fulfill({ json: { ok: true, images: sorted() } })
  })
  return { server, order: () => sorted().map(x => x.id.replace('img:upload:', '')) }
}

const open = (page: Page, query = '') => page.goto(`/e2e/harness/photo-editor.html${query}`)
const rows = (page: Page) => page.locator('.photo-row')
/** The rows' order as the editor shows it: the number in each row's position label and its thumbnail. */
const shown = (page: Page) => page.locator('.photo-thumb').evaluateAll(els => els.map(e => (e.getAttribute('src') ?? '').replace('/fake/', '').replace('?w=400', '')))

test('an entity without photos says so, and a first upload becomes the hero', async ({ page }) => {
  const { server } = await serve(page)
  await open(page)
  await expect(page.getByText('Ingen egne bilder ennå.')).toBeVisible()
  await page.locator('.photo-file').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: PNG })
  await expect(rows(page)).toHaveCount(1)
  await expect(page.locator('.photo-hero-tag')).toBeVisible()
  expect(server.list).toHaveLength(1)
  // The hero has no «Gjør til hovedbilde», and one photo has nothing to move
  await expect(page.getByRole('button', { name: 'Gjør til hovedbilde' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Flytt bilde/ })).toHaveCount(0)
})

test('six photos: the first 4 show in a scroll area, the toggle shows all and folds back', async ({ page }) => {
  await serve(page, 6)
  await open(page)
  await expect(rows(page)).toHaveCount(6)
  await expect(page.getByRole('heading', { name: /Bilder/ })).toContainText('6')
  const area = page.locator('.list-scroll')
  await expect(area).toHaveClass(/collapsed/)
  const visible = () => rows(page).evaluateAll(els => {
    const box = els[0].closest('.list-scroll')!.getBoundingClientRect()
    return els.filter(e => { const r = e.getBoundingClientRect(); return r.top >= box.top - 1 && r.bottom <= box.bottom + 1 }).length
  })
  expect(await visible()).toBe(4)
  await page.getByRole('button', { name: 'Vis alle 6' }).click()
  await expect(area).not.toHaveClass(/collapsed/)
  expect(await visible()).toBe(6)
  await page.getByRole('button', { name: 'Vis færre' }).click()
  expect(await visible()).toBe(4)
})

test('a list of four or fewer is not a scroll view and has no toggle', async ({ page }) => {
  await serve(page, 4)
  await open(page)
  await expect(rows(page)).toHaveCount(4)
  await expect(page.locator('.list-scroll')).not.toHaveClass(/collapsed/)
  await expect(page.locator('.list-toggle')).toHaveCount(0)
})

test('Flytt opens the panel, shows the whole list, and «Til toppen» moves the photo and saves it', async ({ page }) => {
  const { order } = await serve(page, 6)
  await open(page)
  await page.getByRole('button', { name: 'Flytt bilde 3' }).click()
  await expect(page.getByRole('group', { name: 'Plassering for bilde 3' })).toBeVisible()
  await expect(page.locator('.list-scroll')).not.toHaveClass(/collapsed/)   // the panel must not be cut off
  await page.getByRole('button', { name: 'Til toppen' }).click()
  expect(await shown(page)).toEqual(['3', '1', '2', '4', '5', '6'])
  await expect.poll(order).toEqual(['3', '1', '2', '4', '5', '6'])
  // The panel stays with the photo that moved: it is now photo 1, and «Til toppen» is off
  await expect(page.getByRole('button', { name: 'Til toppen' })).toBeDisabled()
})

test('a typed place moves the photo there; a place out of range is refused', async ({ page }) => {
  const { order } = await serve(page, 5)
  await open(page)
  await page.getByRole('button', { name: 'Flytt bilde 1' }).click()
  const input = page.getByRole('textbox', { name: 'Plassering' })
  await input.fill('9')
  await expect(page.getByRole('alert')).toContainText('1 til 5')
  await expect(page.getByRole('button', { name: 'Flytt til valgt plass' })).toBeDisabled()
  await input.fill('4')
  await input.press('Enter')
  await expect.poll(order).toEqual(['2', '3', '4', '1', '5'])
  expect(await shown(page)).toEqual(['2', '3', '4', '1', '5'])
})

test('«Opp» and «Ned» move one place; the ends are disabled', async ({ page }) => {
  const { order } = await serve(page, 3)
  await open(page)
  await page.getByRole('button', { name: 'Flytt bilde 1' }).click()
  await expect(page.getByRole('button', { name: 'Opp', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Ned', exact: true }).click()
  await expect.poll(order).toEqual(['2', '1', '3'])
  await page.getByRole('button', { name: 'Til bunnen' }).click()
  await expect.poll(order).toEqual(['2', '3', '1'])
  await expect(page.getByRole('button', { name: 'Ned', exact: true })).toBeDisabled()
})

test('a click outside the panel, and Escape, close it', async ({ page }) => {
  await serve(page, 3)
  await open(page)
  const panel = page.getByRole('group', { name: /Plassering for/ })
  await page.getByRole('button', { name: 'Flytt bilde 2' }).click()
  await expect(panel).toBeVisible()
  await page.getByRole('heading', { name: /Bilder/ }).click()
  await expect(panel).toHaveCount(0)
  await page.getByRole('button', { name: 'Flytt bilde 2' }).click()
  await page.getByRole('textbox', { name: 'Plassering' }).press('Escape')
  await expect(panel).toHaveCount(0)
})

test('the hero moves to the photo chosen, and a caption is saved when the field is left', async ({ page }) => {
  const { server } = await serve(page, 3)
  await open(page)
  await page.locator('.photo-row').nth(1).getByRole('button', { name: 'Gjør til hovedbilde' }).click()
  await expect(rows(page).nth(1).locator('.photo-hero-tag')).toBeVisible()
  await expect(page.locator('.photo-hero-tag')).toHaveCount(1)
  await expect.poll(() => server.list.filter(x => x.isHero).map(x => x.id)).toEqual(['img:upload:2'])

  const caption = page.getByRole('textbox', { name: 'Bildetekst for bilde 3' })
  await caption.fill('  Ved brua  ')
  await caption.press('Tab')
  await expect.poll(() => server.list.find(x => x.id === 'img:upload:3')!.caption).toBe('Ved brua')
  await caption.fill('')
  await caption.press('Tab')
  await expect.poll(() => server.list.find(x => x.id === 'img:upload:3')!.caption).toBeNull()
})

test('Fjern takes the photo off the list and the server', async ({ page }) => {
  const { order } = await serve(page, 3)
  await open(page)
  await page.locator('.photo-row').nth(1).getByRole('button', { name: 'Fjern' }).click()
  await expect(rows(page)).toHaveCount(2)
  await expect.poll(order).toEqual(['1', '3'])
  await expect(page.getByRole('heading', { name: /Bilder/ })).toContainText('2')
})

test('a move shows at once, even when the server is slow', async ({ page }) => {
  const { server } = await serve(page, 3)
  await page.route('**/api/admin/person/harness/images', async route => {
    if (route.request().method() === 'PATCH') await new Promise(r => setTimeout(r, 1500))
    await route.fallback()
  })
  await open(page)
  await page.getByRole('button', { name: 'Flytt bilde 1' }).click()
  await page.getByRole('button', { name: 'Til bunnen' }).click()
  expect(await shown(page)).toEqual(['2', '3', '1'])    // before the server has answered
  expect(server.writes).toBeLessThanOrEqual(1)
})

test('quick moves reach the server in the order they were made', async ({ page }) => {
  const { order } = await serve(page, 4)
  await open(page)
  await page.getByRole('button', { name: 'Flytt bilde 1' }).click()
  await page.getByRole('button', { name: 'Ned', exact: true }).click()
  await page.getByRole('button', { name: 'Ned', exact: true }).click()
  await page.getByRole('button', { name: 'Ned', exact: true }).click()
  expect(await shown(page)).toEqual(['2', '3', '4', '1'])
  await expect.poll(order).toEqual(['2', '3', '4', '1'])
})

test('a failed save shows the reason and puts the list back as the server has it', async ({ page }) => {
  const { server, order } = await serve(page, 3)
  await open(page)
  server.failNext = true
  await page.getByRole('button', { name: 'Flytt bilde 1' }).click()
  await page.getByRole('button', { name: 'Til bunnen' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Grafen svarte ikke' })).toBeVisible()
  await expect.poll(() => shown(page)).toEqual(['1', '2', '3'])
  expect(order()).toEqual(['1', '2', '3'])
})
