/**
 * Site settings (D1 `site_settings`, migrations/0003): key/value rows an admin
 * edits without a deploy. A missing row means the default, so nothing needs
 * seeding and an unsaved setting shows its default in the admin page.
 *
 * Today: how the changelog page pages its releases, and the site's name.
 */

export interface ChangelogSettings {
  /** Releases shown before anyone presses "Vis flere". */
  initial: number
  /** Releases each "Vis flere" press reveals. */
  step: number
}

export const CHANGELOG_DEFAULTS: ChangelogSettings = { initial: 5, step: 5 }

const KEYS = { initial: 'changelog.initial', step: 'changelog.step' } as const
const MAX = 100

/** A whole number from 1 to 100, or null. Accepts a numeric string, as stored in D1. */
export function parseCount(value: unknown): number | null {
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX ? n : null
}

export type ParseResult = { ok: true; value: ChangelogSettings } | { ok: false; error: string }

export function parseChangelogSettings(body: unknown): ParseResult {
  const b = (body ?? {}) as Record<string, unknown>
  const initial = parseCount(b.initial)
  const step    = parseCount(b.step)
  if (initial === null || step === null) {
    return { ok: false, error: `Begge verdiene må være hele tall fra 1 til ${MAX}.` }
  }
  return { ok: true, value: { initial, step } }
}

/** Saved values, with the default for anything unsaved or unreadable. Never throws: no table yet means defaults. */
export async function readChangelogSettings(db: D1Database | undefined): Promise<ChangelogSettings> {
  if (!db) return CHANGELOG_DEFAULTS
  try {
    const { results } = await db
      .prepare('SELECT key, value FROM site_settings WHERE key IN (?, ?)')
      .bind(KEYS.initial, KEYS.step)
      .all<{ key: string; value: string }>()
    const saved = new Map(results.map(r => [r.key, parseCount(r.value)]))
    return {
      initial: saved.get(KEYS.initial) ?? CHANGELOG_DEFAULTS.initial,
      step:    saved.get(KEYS.step)    ?? CHANGELOG_DEFAULTS.step,
    }
  } catch {
    return CHANGELOG_DEFAULTS
  }
}

export async function writeChangelogSettings(db: D1Database, s: ChangelogSettings): Promise<void> {
  const upsert = `INSERT INTO site_settings (key, value) VALUES (?, ?)
                  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  await db.batch([
    db.prepare(upsert).bind(KEYS.initial, String(s.initial)),
    db.prepare(upsert).bind(KEYS.step,    String(s.step)),
  ])
}

export interface SiteSettings {
  /** The full name: the tab title, the installed app's name. */
  name: string
  /** The short form: the nav logo, the installed app's label. */
  shortName: string
}

export const SITE_DEFAULTS: SiteSettings = { name: 'Milorg 2 Utforsker', shortName: 'Milorg 2' }

const SITE_KEYS = { name: 'site.name', shortName: 'site.shortName' } as const
const NAME_MAX = 60
const SHORT_NAME_MAX = 24

/** Trimmed text of 1..max characters, or null. */
export function parseName(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim()
  return v.length >= 1 && v.length <= max ? v : null
}

export type SiteParseResult = { ok: true; value: SiteSettings } | { ok: false; error: string }

export function parseSiteSettings(body: unknown): SiteParseResult {
  const b = (body ?? {}) as Record<string, unknown>
  const name      = parseName(b.name, NAME_MAX)
  const shortName = parseName(b.shortName, SHORT_NAME_MAX)
  if (name === null || shortName === null) {
    return { ok: false, error: `Navnet kan ha opptil ${NAME_MAX} tegn og kortnavnet opptil ${SHORT_NAME_MAX}; ingen av dem kan være tomme.` }
  }
  return { ok: true, value: { name, shortName } }
}

/** Saved names, with the default for anything unsaved or unreadable. Never throws: no table yet means defaults. */
export async function readSiteSettings(db: D1Database | undefined): Promise<SiteSettings> {
  if (!db) return SITE_DEFAULTS
  try {
    const { results } = await db
      .prepare('SELECT key, value FROM site_settings WHERE key IN (?, ?)')
      .bind(SITE_KEYS.name, SITE_KEYS.shortName)
      .all<{ key: string; value: string }>()
    const saved = new Map(results.map(r => [r.key, r.value]))
    return {
      name:      parseName(saved.get(SITE_KEYS.name), NAME_MAX)            ?? SITE_DEFAULTS.name,
      shortName: parseName(saved.get(SITE_KEYS.shortName), SHORT_NAME_MAX) ?? SITE_DEFAULTS.shortName,
    }
  } catch {
    return SITE_DEFAULTS
  }
}

export async function writeSiteSettings(db: D1Database, s: SiteSettings): Promise<void> {
  const upsert = `INSERT INTO site_settings (key, value) VALUES (?, ?)
                  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  await db.batch([
    db.prepare(upsert).bind(SITE_KEYS.name,      s.name),
    db.prepare(upsert).bind(SITE_KEYS.shortName, s.shortName),
  ])
}
