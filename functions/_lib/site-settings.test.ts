import { describe, expect, it } from 'vitest'
import {
  CHANGELOG_DEFAULTS, parseChangelogSettings, parseCount, readChangelogSettings, writeChangelogSettings,
} from './site-settings.ts'

/** D1 stand-in: a key → value map answering the two statements the module uses. */
function fakeDb(rows: Record<string, string>, opts: { failRead?: boolean } = {}) {
  const writes: [string, string][] = []
  return {
    writes,
    prepare() {
      let args: unknown[] = []
      const stmt = {
        bind(...a: unknown[]) { args = a; return stmt },
        all() {
          if (opts.failRead) return Promise.reject(new Error('no such table: site_settings'))
          return Promise.resolve({ results: Object.entries(rows).filter(([k]) => args.includes(k)).map(([key, value]) => ({ key, value })) })
        },
        run: () => { writes.push([args[0] as string, args[1] as string]) },
      }
      return stmt
    },
    batch(stmts: { run(): unknown }[]) { for (const s of stmts) s.run(); return Promise.resolve([]) },
  } as unknown as D1Database & { writes: [string, string][] }
}

describe('parseCount', () => {
  it('accepts whole numbers 1..100, also as digit strings', () => {
    expect(parseCount(5)).toBe(5)
    expect(parseCount('12')).toBe(12)
    expect(parseCount(100)).toBe(100)
  })

  it('rejects everything else', () => {
    for (const v of [0, -1, 101, 2.5, '', 'abc', '5.5', null, undefined, NaN, true]) {
      expect(parseCount(v)).toBeNull()
    }
  })
})

describe('parseChangelogSettings', () => {
  it('needs both values', () => {
    expect(parseChangelogSettings({ initial: 3, step: 7 })).toEqual({ ok: true, value: { initial: 3, step: 7 } })
    expect(parseChangelogSettings({ initial: 3 }).ok).toBe(false)
    expect(parseChangelogSettings(null).ok).toBe(false)
    expect(parseChangelogSettings({ initial: 0, step: 5 }).ok).toBe(false)
  })
})

describe('readChangelogSettings', () => {
  it('defaults to 5 and 5 when nothing is saved', async () => {
    expect(await readChangelogSettings(fakeDb({}))).toEqual({ initial: 5, step: 5 })
    expect(CHANGELOG_DEFAULTS).toEqual({ initial: 5, step: 5 })
  })

  it('uses saved values and defaults the missing or unreadable one', async () => {
    expect(await readChangelogSettings(fakeDb({ 'changelog.initial': '8', 'changelog.step': '3' }))).toEqual({ initial: 8, step: 3 })
    expect(await readChangelogSettings(fakeDb({ 'changelog.initial': '8' }))).toEqual({ initial: 8, step: 5 })
    expect(await readChangelogSettings(fakeDb({ 'changelog.step': 'junk' }))).toEqual({ initial: 5, step: 5 })
  })

  it('falls back to defaults without a binding or before the migration has run', async () => {
    expect(await readChangelogSettings(undefined)).toEqual({ initial: 5, step: 5 })
    expect(await readChangelogSettings(fakeDb({}, { failRead: true }))).toEqual({ initial: 5, step: 5 })
  })
})

describe('writeChangelogSettings', () => {
  it('upserts both keys', async () => {
    const db = fakeDb({})
    await writeChangelogSettings(db, { initial: 10, step: 4 })
    expect(db.writes).toEqual([['changelog.initial', '10'], ['changelog.step', '4']])
  })
})
