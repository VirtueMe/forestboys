import { describe, expect, it } from 'vitest'
import { decide } from './e2e-needed.ts'

describe('decide: does the change need the end-to-end tests?', () => {
  it('skips when every changed file is on the safe list', () => {
    const d = decide(['docs/PROPOSALS.md', 'README.md', 'wrangler.toml', '.github/ISSUE_TEMPLATE/bug_report.yml'], 'pull_request')
    expect(d.run).toBe(false)
    expect(d.reason).toContain('cannot affect the tests')
  })

  it('runs when one file is not on the list, and names it', () => {
    const d = decide(['docs/PROPOSALS.md', 'src/App.vue'], 'pull_request')
    expect(d.run).toBe(true)
    expect(d.reason).toContain('src/App.vue')
    expect(d.reason).not.toContain('docs/PROPOSALS.md')
  })

  it.each([
    'package.json',
    'package-lock.json',
    '.nvmrc',
    'vite.config.ts',
    'playwright.config.ts',
    'index.html',
    'public/icon.svg',
    'e2e/smoke.spec.ts',
    'e2e/fixtures/person-bernt-balchen.json',
    'scripts/e2e/replay-key.ts',
    'functions/api/x.ts',
    '.github/workflows/ci.yml',
    // a different wrangler.toml, and markdown below src/ (which can be imported with ?raw)
    'workers/bundle-events/wrangler.toml',
    'src/notes/about.md',
    'docsx/readme.md',
  ])('runs for %s', file => {
    expect(decide([file], 'pull_request').run).toBe(true)
  })

  it('runs for a file moved out of src/ into docs/: both paths are listed', () => {
    expect(decide(['src/old.ts', 'docs/old.ts'], 'pull_request').run).toBe(true)
  })

  it('runs on a push to main, whatever the files are', () => {
    expect(decide(['docs/PROPOSALS.md'], 'push').run).toBe(true)
    expect(decide(null, 'push').run).toBe(true)
  })

  it('runs when the files cannot be listed, or the list is empty', () => {
    expect(decide(null, 'pull_request').run).toBe(true)
    expect(decide([], 'pull_request').run).toBe(true)
  })

  it('runs for an event it does not know', () => {
    expect(decide(['README.md'], 'workflow_dispatch').run).toBe(true)
    expect(decide(['README.md'], '').run).toBe(true)
  })

  describe('a release-please PR', () => {
    const release = ['package.json', 'package-lock.json', 'CHANGELOG.md', '.release-please-manifest.json']

    it('skips when it changes only the version files and the changelog', () => {
      expect(decide(release, 'pull_request', 'release-please--branches--main').run).toBe(false)
    })

    it('runs when it also changes anything else', () => {
      expect(decide([...release, 'src/App.vue'], 'pull_request', 'release-please--branches--main').run).toBe(true)
    })

    it('does not get the exception from another branch', () => {
      expect(decide(release, 'pull_request', 'chore/1_bump').run).toBe(true)
      expect(decide(release, 'pull_request').run).toBe(true)
    })
  })

  it('shortens a long list of files in the reason', () => {
    const files = Array.from({ length: 8 }, (_, i) => `src/f${i}.ts`)
    const d = decide(files, 'pull_request')
    expect(d.reason).toContain('8 changed files')
    expect(d.reason).toContain('…')
    expect(d.reason).not.toContain('src/f7.ts')
  })
})
