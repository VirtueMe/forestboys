/**
 * A Station's category — the one controlled value (Skole / Base / Annet) next
 * to the free-text function ("SOE Training School", "MTB base"). It only
 * suggests a default role for a person's link (#70); the link's own role
 * decides where the person appears. Mirrored server-side in
 * functions/_lib/station-category.ts.
 */

export const STATION_CATEGORIES = ['training', 'base', 'other'] as const
export type StationCategory = typeof STATION_CATEGORIES[number]

export const STATION_CATEGORY_LABEL: Record<StationCategory, string> = {
  training: 'Skole',
  base:     'Base',
  other:    'Annet',
}

export function isStationCategory(v: unknown): v is StationCategory {
  return typeof v === 'string' && (STATION_CATEGORIES as readonly string[]).includes(v)
}

/**
 * The role a person's link to a station gets by default when the station
 * links are imported (scripts/migrations/migrate-stationed-at.ts): `training` at a Skole,
 * `stationed` everywhere else. The station's category when it has one, else
 * the one its free-text type suggests. A default only — what a person did
 * there is per link, and Jan corrects it.
 */
export function defaultRoleForStation(category: unknown, type: string | null | undefined): 'training' | 'stationed' {
  const c = isStationCategory(category) ? category : suggestStationCategory(type)
  return c === 'training' ? 'training' : 'stationed'
}

/**
 * A guess at the category from the free-text type Sanity gave the station
 * (~55 spellings, some misspelled). Only a suggestion: it is wrong for some
 * stations (Stn. VIII is typed "SOE Training School" but was a workshop), so
 * the editor shows it as a hint and never sets it by itself.
 * Null when the type says nothing or is not recognised.
 */
export function suggestStationCategory(type: string | null | undefined): StationCategory | null {
  const t = (type ?? '').trim().toLowerCase()
  if (!t) return null

  if (/school|skole|academy|training|opplæring|depot/.test(t)) return 'training'
  if (/research bureau|^scrapped|^soe$|^mak$|^[\d\s.,-]+$/.test(t)) return 'other'
  if (/air\s?fi|airfield|base|station|port\b|havn|harbou?r|convoy|konvoi|shipwarf|camp|town|supply|flåte|sea\s?plane|sjøfly|ubåt/.test(t)) return 'base'
  return null
}
