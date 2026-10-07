import { describe, expect, it } from 'vitest'
import { flakyTests, summaryOf, type JsonReport } from './flaky-summary.ts'

const test = (status: 'expected' | 'unexpected' | 'flaky' | 'skipped', attempts = 1) => ({ projectName: 'chromium', status, results: new Array(attempts).fill({}) })

// The shape Playwright's JSON reporter writes: a file is a suite, a describe block a suite inside it.
const report: JsonReport = {
  suites: [
    {
      title: 'editor-lists.spec.ts',
      suites: [{
        title: 'lists',
        specs: [
          { title: 'Enter continues a list', file: 'editor-lists.spec.ts', line: 24, tests: [test('expected')] },
          { title: 'Tab indents an item', file: 'editor-lists.spec.ts', line: 41, tests: [test('flaky', 2)] },
        ],
      }],
    },
    {
      title: 'smoke.spec.ts',
      specs: [{ title: 'the app starts', file: 'smoke.spec.ts', line: 5, tests: [test('flaky', 2)] }],
    },
  ],
}

describe('flakyTests', () => {
  it('lists the tests that failed and passed on the retry, with their describe block, file and line', () => {
    expect(flakyTests(report)).toEqual([
      { title: 'lists › Tab indents an item', file: 'e2e/editor-lists.spec.ts', line: 41, attempts: 2 },
      { title: 'the app starts', file: 'e2e/smoke.spec.ts', line: 5, attempts: 2 },
    ])
  })

  it('does not list a test that passed, failed twice or was skipped', () => {
    const none: JsonReport = { suites: [{ title: 'a.spec.ts', specs: [
      { title: 'passed', file: 'a.spec.ts', line: 1, tests: [test('expected')] },
      { title: 'failed', file: 'a.spec.ts', line: 2, tests: [test('unexpected', 2)] },
      { title: 'skipped', file: 'a.spec.ts', line: 3, tests: [test('skipped', 0)] },
    ] }] }
    expect(flakyTests(none)).toEqual([])
  })

  it('reads an empty report', () => {
    expect(flakyTests({})).toEqual([])
  })
})

describe('summaryOf', () => {
  it('says so when nothing was flaky, so the step is seen to have run', () => {
    expect(summaryOf([])).toContain('no flaky tests')
  })

  it('names each flaky test with where it is, and says how many', () => {
    const text = summaryOf(flakyTests(report))
    expect(text).toContain('2 flaky tests')
    expect(text).toContain('`e2e/editor-lists.spec.ts:41` lists › Tab indents an item (2 attempts)')
    expect(text).toContain('`e2e/smoke.spec.ts:5` the app starts (2 attempts)')
  })

  it('says «1 flaky test» in the singular', () => {
    expect(summaryOf(flakyTests(report).slice(0, 1))).toContain('1 flaky test\n')
  })
})
