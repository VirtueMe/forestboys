/**
 * Record the pages of e2e/pages.ts from the local graph, for the browser design checks (#139):
 *
 *   npm run dev:worker                      # the local worker, which reads the local graph (.dev.vars)
 *   npx tsx scripts/e2e/record-fixtures.ts          # a dry run: what would be recorded
 *   npx tsx scripts/e2e/record-fixtures.ts --write  # writes e2e/fixtures/<kind>-<slug>.json
 *
 * It opens each page in a browser, as a visitor who is not logged in, and keeps every
 * `POST /api/neo4j/query` and every same-origin `/sanity/` GET with its answer. A page that has an edit mode
 * is then opened again as an admin (`/auth/me` answered with role `admin`, no login) with «Rediger» chosen, and
 * what the edit mode asks for is kept in the same recording (#140). The registry-wide queries
 * the app runs on start-up (no parameters, thousands of rows) are kept to their first rows, and say so
 * (`truncatedFrom`), in a fixed order and with the rows that mention the page's own slug kept as well; a
 * query with parameters is kept whole. Run it again when a page's
 * queries change: the replay then finds nothing for the new query and the test says which.
 * It only ever talks to a local worker.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { chromium, type Response } from '@playwright/test'
import { fixturePath, PAGES, type PageTarget } from '../../e2e/pages.ts'
import { capRows, requestKey, STAND_IN_ADMIN, type PageRecording, type RecordedGet, type RecordedQuery } from './replay-key.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const BASE = process.env.RECORD_BASE ?? 'http://localhost:8788'
const WRITE = process.argv.includes('--write')

const host = new URL(BASE).hostname
if (host !== 'localhost' && host !== '127.0.0.1') {
  console.error(`Refusing to record from ${BASE}: only a local worker (RECORD_BASE must be localhost).`)
  process.exit(2)
}

type Browser = Awaited<ReturnType<typeof chromium.launch>>

async function record(target: PageTarget, browser: Browser): Promise<PageRecording> {
  const { path, slug } = target
  const queries = new Map<string, RecordedQuery>()
  const gets = new Map<string, RecordedGet>()
  const pending: Promise<void>[] = []

  /** Open the page once, as a visitor or as an admin in edit mode, and keep what it asks for. */
  async function visit(asAdmin: boolean) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

    page.on('response', (r: Response) => {
      const req = r.request()
      const url = new URL(r.url())
      if (url.origin !== BASE) return
      if (req.method() === 'POST' && url.pathname === '/api/neo4j/query') {
        pending.push((async () => {
          const body = req.postDataJSON() as { query: string; params?: Record<string, unknown> }
          const json = (await r.json()) as { rows?: unknown[] }
          if (r.ok() && json.rows) queries.set(requestKey(body.query, body.params), capRows(body.query, body.params ?? {}, json.rows, slug))
        })())
      } else if (req.method() === 'GET' && url.pathname.startsWith('/sanity/')) {
        pending.push((async () => {
          gets.set(url.pathname + url.search, {
            url: url.pathname + url.search, status: r.status(), contentType: r.headers()['content-type'] ?? 'application/json', body: await r.text(),
          })
        })())
      }
    })

    if (asAdmin) await page.route('**/auth/me', route => route.fulfill({ json: STAND_IN_ADMIN }))
    await page.goto(BASE + path)
    await page.waitForLoadState('networkidle')
    if (asAdmin) {
      await page.getByRole('button', { name: 'Rediger', exact: true }).click()
      await page.waitForLoadState('networkidle')
    }
    // Sections below the fold may load when they come into view.
    for (let y = 0; y < 6; y++) { await page.mouse.wheel(0, 1200); await page.waitForTimeout(250) }
    await page.waitForLoadState('networkidle')
    await Promise.all(pending)
    await page.close()
  }

  await visit(false)
  if (target.edit !== false) await visit(true)

  // In the order of their keys, not of their arrival: responses come back in whatever order the timing gives,
  // and a recording that is written in a different order every time shows a change where there is none.
  const byKey = <T,>(m: Map<string, T>) => [...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, v]) => v)
  return { path, queries: byKey(queries), gets: byKey(gets) }
}

const browser = await chromium.launch()
try {
  for (const target of PAGES) {
    const recording = await record(target, browser)
    const text = JSON.stringify(recording, null, 1) + '\n'
    console.log(`${target.path.padEnd(28)} ${String(recording.queries.length).padStart(3)} queries, ${recording.gets.length} sanity gets, ${(text.length / 1024).toFixed(0)} KB`)
    if (recording.queries.length === 0) throw new Error(`${target.path}: no queries were seen. Is the worker running on ${BASE}?`)
    if (WRITE) {
      const file = join(ROOT, fixturePath(target))
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, text)
    }
  }
} finally {
  await browser.close()
}
console.log(WRITE ? 'Written.' : 'Dry run: nothing written. Pass --write.')
