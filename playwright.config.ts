import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests (#129). Kept apart from `npm test` (vitest, in node) so that stays fast:
 * `npm run test:e2e`. They run against the Vite dev server, not the build, because the editor
 * harness (e2e/harness) is a dev-only page that the production build does not contain.
 *
 * One browser to start: Chromium. `npx playwright install chromium` fetches it. CI installs only the headless
 * shell (`--only-shell`), which is what these tests run in; a headed run (`--headed`, `--ui`) needs the full one.
 */

const PORT = Number(process.env.E2E_PORT ?? 5174)

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  // On CI the JSON report is what scripts/e2e/flaky-summary.ts reads: a test that passed on the retry shows
  // as «flaky» there (#149). It is in test-results/, which the html reporter does not clear.
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/e2e-report.json' }]]
    : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // A trace of a failed test is the first thing to open: every action, DOM snapshot and request.
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    // vite.config.ts asks git for release notes, and with CI set it unshallows the whole clone to find a
    // tag. The tests need none of that, so the dev server is started as if it were not in CI.
    env: { CI: '' },
  },
})
