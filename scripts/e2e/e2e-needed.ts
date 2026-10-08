/**
 * Does this change need the end-to-end tests (#173)?
 *
 * The ruleset «Protect main» requires the check «End-to-end (Playwright)» by name, so the job must always run and
 * report. This is its first step: it decides whether the expensive steps (npm ci, the browser, the tests) follow.
 * A job that is skipped as a whole leaves the required check pending for ever; a job whose steps are skipped is green.
 *
 * The rule fails safe: the tests are skipped only when EVERY changed file is on the list below of files that cannot
 * change what they see. A file nobody thought of is not on it, so it makes the tests run. Anything we cannot tell
 * (a push to main, no list of files, git failing) runs them too.
 *
 *   node scripts/e2e/e2e-needed.ts
 *
 * Reads GITHUB_EVENT_NAME and GITHUB_HEAD_REF, writes `run=true|false` to GITHUB_OUTPUT and a line to
 * GITHUB_STEP_SUMMARY. Plain Node, no tsx: the types are stripped when it runs.
 */

import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/**
 * Files that cannot affect the tests. Checked in order; a path is safe if any one matches.
 * - the e2e tests read their pages from e2e/fixtures and the version from package.json: nothing here;
 * - only the root wrangler.toml: workers/bundle-events/wrangler.toml is a different file and is not listed;
 * - markdown only at the root or under docs/: a .md under src/ may be imported with ?raw.
 */
const SAFE: RegExp[] = [
  /^docs\//,
  /^[^/]+\.md$/,
  /^\.github\/ISSUE_TEMPLATE\//,
  /^\.github\/bot-templates\//,
  /^\.github\/PULL_REQUEST_TEMPLATE\.md$/,
  /^wrangler\.toml$/,
  /^LICENSE$/,
]

/**
 * What a release-please PR changes: the version and the changelog. CHANGELOG.md is already safe, since
 * ChangelogView.vue imports it with ?raw but no e2e test visits /endringslogg; if one ever does, remove
 * CHANGELOG.md from SAFE (the `^[^/]+\.md$` pattern) and from here, and it runs for every release PR.
 */
const RELEASE_PLEASE_BRANCH = 'release-please--'
const RELEASE_PLEASE_FILES = new Set(['package.json', 'package-lock.json', '.release-please-manifest.json'])

export interface Decision {
  run:    boolean
  reason: string
}

const isSafe = (file: string) => SAFE.some(re => re.test(file))

/** Run the tests unless every changed file is safe. `event` and `headRef` are GitHub's event name and the PR's head branch. */
export function decide(files: string[] | null, event: string, headRef = ''): Decision {
  if (event !== 'pull_request') return { run: true, reason: `a ${event || 'unknown'} event always runs the whole job` }
  if (files === null || files.length === 0) return { run: true, reason: 'the changed files could not be listed, so the tests run to be safe' }

  const releasePlease = headRef.startsWith(RELEASE_PLEASE_BRANCH)
  const unsafe = files.filter(f => !isSafe(f) && !(releasePlease && RELEASE_PLEASE_FILES.has(f)))
  if (unsafe.length > 0) {
    const shown = unsafe.slice(0, 5).join(', ')
    return { run: true, reason: `${unsafe.length} changed ${unsafe.length === 1 ? 'file' : 'files'} can affect the tests: ${shown}${unsafe.length > 5 ? ', …' : ''}` }
  }
  return {
    run:    false,
    reason: `only files that cannot affect the tests changed (${files.length}): ${files.slice(0, 5).join(', ')}${files.length > 5 ? ', …' : ''}`,
  }
}

/**
 * What the PR changes against its base. On a pull_request the checkout is the merge commit of the head into the base,
 * so its first parent is the base. --no-renames lists both paths of a move: a file moved from src/ to docs/ must
 * show src/ too. Null when git cannot say (a checkout that is too shallow).
 */
function changedFiles(): string[] | null {
  try {
    const out = execFileSync('git', ['diff', '--name-only', '--no-renames', 'HEAD^1', 'HEAD'], { encoding: 'utf8' })
    return out.split('\n').filter(Boolean)
  } catch {
    return null
  }
}

function main() {
  const event = process.env.GITHUB_EVENT_NAME ?? ''
  const decision = decide(event === 'pull_request' ? changedFiles() : null, event, process.env.GITHUB_HEAD_REF)
  const line = decision.run
    ? `### End-to-end: ran\n\nThe tests ran: ${decision.reason}.\n`
    : `### End-to-end: skipped, not run\n\nThe tests did **not** run, and this green check is not a test result: ${decision.reason}.\n`
  console.log(line)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `run=${decision.run}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
