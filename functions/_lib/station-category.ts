/**
 * A Station's category: `training` (skole), `base` or `other` (docs/SCHEMA.md).
 * Mirrored client-side in src/utils/stationCategory.ts, which also has the
 * labels and the suggestion from the free-text type.
 */

export const STATION_CATEGORIES = ['training', 'base', 'other'] as const
export type StationCategory = typeof STATION_CATEGORIES[number]

export function isStationCategory(v: unknown): v is StationCategory {
  return typeof v === 'string' && (STATION_CATEGORIES as readonly string[]).includes(v)
}
