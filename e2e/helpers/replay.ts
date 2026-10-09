/**
 * Replay a recorded page (#139): the page runs as it does, in the browser, and everything it asks the
 * server for is answered from the recording, so CI needs no graph. See scripts/e2e/replay-key.ts for how a
 * request is found again, and scripts/e2e/record-fixtures.ts for how a page is recorded.
 *
 * What is not in the recording is not invented: a query that was not recorded is answered with no rows
 * and listed in `misses()`, and a test that loads a page checks the list is empty. A page whose queries
 * changed then fails by naming the query that needs recording again.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { describeRequest, requestKey, STAND_IN_ADMIN, type PageRecording } from '../../scripts/e2e/replay-key.ts'
import { fixturePath, type PageTarget } from '../pages.ts'

const ROOT = join(import.meta.dirname, '..', '..')

/** A transparent 1x1 PNG: what every image of the real site is replaced with. */
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

export interface Replay {
  /** What the page asked for that the recording does not have. Empty when the recording is whole. */
  misses(): string[]
}

export interface ReplayOptions {
  /**
   * Who is looking. A visitor who is not logged in (the default) sees the public page. An admin sees the
   * tabs «Forhåndsvisning» and «Rediger»: the page asks `/auth/me`, and an answer with role `admin` is all it
   * takes, so no login and no session are needed (#140).
   */
  as?: 'visitor' | 'admin'
}

export async function replayPage(page: Page, target: PageTarget, options: ReplayOptions = {}): Promise<Replay> {
  const recording = JSON.parse(readFileSync(join(ROOT, fixturePath(target)), 'utf8')) as PageRecording
  const queries = new Map(recording.queries.map(q => [requestKey(q.query, q.params), q]))
  const gets = new Map(recording.gets.map(g => [g.url, g]))
  const misses: string[] = []

  // Routes registered later win, so the general ones come first.
  await page.route('**/api/**', route => {
    misses.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`)
    return route.fulfill({ status: 404, json: { error: 'not recorded' } })
  })
  // The site's name (#153) is not part of a page's content, so it is not recorded: every page gets the defaults.
  await page.route('**/api/site-settings/site', route => route.fulfill({ json: { name: 'Milorg 2 Utforsker', shortName: 'Milorg 2' } }))
  await page.route('**/sanity/**', route => {
    const url = new URL(route.request().url())
    const hit = gets.get(url.pathname + url.search)
    if (!hit) { misses.push(`GET ${url.pathname + url.search}`); return route.fulfill({ status: 404, json: { error: 'not recorded' } }) }
    return route.fulfill({ status: hit.status, contentType: hit.contentType, body: hit.body })
  })
  await page.route('**/api/neo4j/query', route => {
    const body = route.request().postDataJSON() as { query: string; params?: Record<string, unknown> }
    const hit = queries.get(requestKey(body.query, body.params))
    if (!hit) { misses.push(`neo4j: ${describeRequest(body.query, body.params)}`); return route.fulfill({ json: { rows: [] } }) }
    return route.fulfill({ json: { rows: hit.rows } })
  })
  if (options.as === 'admin') {
    await page.route('**/auth/me', route => route.fulfill({ json: STAND_IN_ADMIN }))
    // What only an admin's page asks for, answered as «nothing»: no open proposals, and a live stream of proposal
    // changes that says nothing (a long retry, so the browser does not reconnect again and again).
    await page.route(/\/api\/admin\/[^/]+\/[^/]+\/proposals$/, route => route.fulfill({ json: { openBundles: [], generationPending: false } }))
    await page.route('**/api/proposals/events**', route => route.fulfill({ contentType: 'text/event-stream', body: 'retry: 3600000\n\n' }))
  } else {
    // A visitor who is not logged in: the public view of the page.
    await page.route('**/auth/me', route => route.fulfill({ status: 401, json: { error: 'Not authenticated' } }))
  }

  // The world outside is not needed to judge a page and would make the tests depend on the network:
  // fonts fall back to the system's, map tiles are left out, images become one pixel.
  await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|basemaps\.cartocdn\.com|tiles\.basemaps\.cartocdn\.com)\//, route => route.abort())
  await page.route(/^https:\/\/cdn\.sanity\.io\//, route => route.fulfill({ contentType: 'image/png', body: PIXEL }))

  return { misses: () => misses }
}

/** Wait until the page has finished drawing: the network is quiet and the amount of text on it is the same on two looks in a row. */
async function settled(page: Page, what: string) {
  await page.waitForLoadState('networkidle')
  let last = -1
  await expect.poll(async () => {
    const now = await page.evaluate(() => (document.body.innerText || '').length)
    const stable = now === last
    last = now
    return stable
  }, { message: `${what} kept changing`, intervals: [150], timeout: 10_000 }).toBe(true)
}

/**
 * Open a recorded page and wait until it has finished drawing: its title text is there, the network is quiet, and
 * the amount of text on it is the same on two looks in a row (sections mount a moment after their data). A
 * fixed wait would be too long on a fast machine and too short on a slow one.
 */
export async function openRecordedPage(page: Page, target: PageTarget, options: ReplayOptions = {}): Promise<Replay> {
  const replay = await replayPage(page, target, options)
  await page.goto(target.path)
  // The title is on the page, whatever element it is in: a test of the outline must be able to say «no h1».
  await expect(page.getByText(target.title).first()).toBeVisible()
  await settled(page, target.path)
  return replay
}

/** The page as an admin sees it in edit mode: opened as an admin, and the «Rediger» tab chosen (#140). */
export async function openRecordedEditMode(page: Page, target: PageTarget): Promise<Replay> {
  const replay = await openRecordedPage(page, target, { as: 'admin' })
  const tab = page.getByRole('button', { name: 'Rediger', exact: true })
  await tab.click()
  await expect(tab).toHaveClass(/active/)                    // the edit mode is what is being looked at, not the preview
  await settled(page, `${target.path} in edit mode`)
  return replay
}
