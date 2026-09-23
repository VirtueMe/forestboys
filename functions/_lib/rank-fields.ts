/**
 * Shared body validation for the Rank admin endpoints (POST create,
 * PATCH update). Only fields present in the body are returned, so
 * PATCH writes exactly what the client changed.
 *
 * `countries` is the rank's own list of country codes — deliberately
 * independent of the branch (a rank can span several countries, and
 * branches don't carry that meaning today).
 *
 * `branchSlug` is kept apart from `props` — it's an edge
 * ((:Rank)-[:IN]->(:Organization)), not a node property. `undefined`
 * means "leave alone", `null` means "detach".
 */

export interface RankFields {
  props:       Record<string, unknown>
  branchSlug?: string | null
}

export function parseRankFields(body: Record<string, unknown>): RankFields | { error: string } {
  const props: Record<string, unknown> = {}

  if ('canonicalName' in body) {
    const v = typeof body.canonicalName === 'string' ? body.canonicalName.trim() : ''
    if (!v) return { error: 'canonicalName må være en tekst' }
    props.canonicalName = v
  }
  if ('abbreviation' in body) {
    const v = body.abbreviation
    if (v !== null && typeof v !== 'string') return { error: 'abbreviation må være tekst eller null' }
    props.abbreviation = typeof v === 'string' && v.trim() ? v.trim() : null
  }
  if ('tier' in body) {
    const v = body.tier
    if (v !== null && (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 20)) {
      return { error: 'tier må være et heltall 1–20 eller null' }
    }
    props.tier = v
  }

  if ('countries' in body) {
    const v = body.countries
    if (v !== null && !Array.isArray(v)) return { error: 'countries må være en liste eller null' }
    const codes = (v ?? []).map(c => typeof c === 'string' ? c.trim().toUpperCase() : '')
    if (codes.some(c => !/^[A-Z]{2}$/.test(c))) return { error: 'countries må være landkoder på to bokstaver (NO, UK, …)' }
    // Empty list clears the property rather than storing [].
    props.countries = codes.length ? [...new Set(codes)] : null
  }

  let branchSlug: string | null | undefined
  if ('branchSlug' in body) {
    const v = body.branchSlug
    if (v !== null && (typeof v !== 'string' || !/^[a-z0-9-]+$/.test(v))) return { error: 'branchSlug må være en slug eller null' }
    branchSlug = v
  }

  return { props, branchSlug }
}
