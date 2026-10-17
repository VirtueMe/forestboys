/**
 * The plan for filling Station.category (#303): the category the free-text `type` suggests (src/utils/stationCategory.ts),
 * set only where the station has none, plus the tidying of the stray types. A category someone set is never touched, and a
 * type that suggests nothing is listed for Jan instead of guessed. Pure; scripts/migrations/fill-station-category.ts runs it.
 */

import { isStationCategory, suggestStationCategory, type StationCategory } from '../../src/utils/stationCategory.ts'
import { tidyText } from '../../src/utils/tidyText.ts'

export interface StationRow {
  slug:     string
  name:     string | null
  type:     string | null
  category: unknown
}

/** The spellings of «Airfield» that Sanity holds. */
const AIRFIELD_MISSPELLED = /^airfi+e?l(?:e?d)?$/i
/** A type that is a pair of coordinates, whole or half: not a function. */
const COORDINATES = /^[\d\s.,-]+$/

export interface TypeTidy { slug: string; from: string; to: string | null }
export interface CategoryFill { slug: string; type: string | null; category: StationCategory }

export interface StationCategoryPlan {
  /** Types to rewrite: `to` is null when the type was coordinates (the old value is listed, not kept). */
  types:     TypeTidy[]
  /** Stations that get a category now. */
  fills:     CategoryFill[]
  /** Stations with no category whose type suggests none: for Jan. */
  unclear:   { slug: string; name: string | null; type: string | null }[]
  /** Stations that already had a category. */
  kept:      number
}

/** The type after tidying, or the same string when there is nothing to tidy. null: no type left. */
export function tidyStationType(type: string | null): string | null {
  const t = tidyText(type)
  if (t === null) return null
  if (AIRFIELD_MISSPELLED.test(t)) return 'Airfield'
  if (COORDINATES.test(t)) return null
  return t
}

export function planStationCategories(stations: StationRow[]): StationCategoryPlan {
  const plan: StationCategoryPlan = { types: [], fills: [], unclear: [], kept: 0 }
  for (const s of stations) {
    const type = tidyStationType(s.type)
    if (s.type !== null && type !== s.type) plan.types.push({ slug: s.slug, from: s.type, to: type })
    if (isStationCategory(s.category)) { plan.kept++; continue }
    const category = suggestStationCategory(type)
    if (category) plan.fills.push({ slug: s.slug, type, category })
    else plan.unclear.push({ slug: s.slug, name: s.name, type: s.type })
  }
  return plan
}
