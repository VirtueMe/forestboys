/**
 * The tests that failed and passed on the retry (#149), from Playwright's JSON report.
 *
 * CI retries a failing test once (playwright.config.ts), so a flaky test leaves the job green and shows
 * only as «flaky» inside the HTML report. This puts them where they are seen: in the job's summary, and
 * as a warning on the run. It never fails the job: a test that failed twice has already done that.
 *
 *   node scripts/e2e/flaky-summary.ts test-results/e2e-report.json
 *
 * Plain Node, no tsx: the types are stripped when it runs.
 */

import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

interface JsonTest { projectName?: string; status: 'expected' | 'unexpected' | 'flaky' | 'skipped'; results: unknown[] }
interface JsonSpec { title: string; file: string; line: number; tests: JsonTest[] }
interface JsonSuite { title: string; suites?: JsonSuite[]; specs?: JsonSpec[] }
export interface JsonReport { suites?: JsonSuite[] }

export interface Flaky {
  /** The describe blocks and the test's title, in one line. */
  title:    string
  file:     string
  line:     number
  /** How many times it ran: 2 when it passed on the one retry. */
  attempts: number
}

/** The report names a file relative to the test directory; the run's annotations want it from the repository root. */
const TEST_DIR = 'e2e'

/** Every test that failed and then passed, in the order the report lists them. */
export function flakyTests(report: JsonReport, testDir = TEST_DIR): Flaky[] {
  const out: Flaky[] = []
  const walk = (suite: JsonSuite, path: string[]) => {
    // A file is a suite titled by its own name; the names that matter are the describe blocks below it.
    const here = suite.title && !/\.spec\.ts$/.test(suite.title) ? [...path, suite.title] : path
    for (const spec of suite.specs ?? []) {
      const test = spec.tests.find(t => t.status === 'flaky')
      if (test) out.push({ title: [...here, spec.title].join(' › '), file: `${testDir}/${spec.file}`, line: spec.line, attempts: test.results.length })
    }
    for (const child of suite.suites ?? []) walk(child, here)
  }
  for (const suite of report.suites ?? []) walk(suite, [])
  return out
}

/** The markdown for the job's summary: a line when nothing was flaky, so the step is seen to have run. */
export function summaryOf(flaky: Flaky[]): string {
  if (flaky.length === 0) return '### End-to-end: no flaky tests\n\nEvery test passed on its first attempt.\n'
  const rows = flaky.map(f => `- \`${f.file}:${f.line}\` ${f.title} (${f.attempts} attempts)`)
  return [
    `### End-to-end: ${flaky.length} flaky ${flaky.length === 1 ? 'test' : 'tests'}`,
    '',
    'These failed and passed on the retry, so the job is green. A flaky test is a real problem that only happens sometimes: look at it, the trace is in the `playwright-report` artifact.',
    '',
    ...rows,
    '',
  ].join('\n')
}

function main() {
  const path = process.argv[2]
  if (!path || !existsSync(path)) {
    // The tests did not get as far as a report (a crash, a cancelled run): nothing to say about flakiness.
    console.log(`no report at ${path ?? '(no path given)'}; nothing to summarise`)
    return
  }
  const flaky = flakyTests(JSON.parse(readFileSync(path, 'utf8')) as JsonReport)
  const summary = summaryOf(flaky)
  console.log(summary)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`)
  for (const f of flaky) console.log(`::warning file=${f.file},line=${f.line}::flaky: ${f.title} failed and passed on the retry`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
