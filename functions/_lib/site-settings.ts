/**
 * Site settings (D1 `site_settings`, migrations/0003): key/value rows an admin
 * edits without a deploy. A missing row means the default, so nothing needs
 * seeding and an unsaved setting shows its default in the admin page.
 *
 * Today: how the changelog page pages its releases.
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
