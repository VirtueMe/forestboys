/**
 * Find the page a link really meant.
 *
 * A link in an event description names its target by slug and the renderer
 * sends every bare slug to /events/<slug>. Many of them are not events: a
 * person (`john-rognes`), a vessel (`hms-rodney`), or an event written a
 * little differently from its page (`SUB004` for `sub004`, `mtb-x037` for
 * `mtb-x37`, `ax13` for `ax-13`). This looks the slug up across the kinds of
 * page and says where it should go, when that is certain.
 *
 * Certain means: the page with exactly that slug, or else the one page whose
 * slug is the same apart from capitals, hyphens, spaces, dots and leading
 * zeros. Two candidates is not certain, and nothing is guessed.
 */

export type QueryFn = (cypher: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>[]>

/** The page of each kind of node that has a slug. */
export const KIND_ROUTES: Record<string, string> = {
  Operation: '/events/',
  Incident: '/events/',          // an event page too; the two kinds share one address space
  Person: '/person/',
  Location: '/map/',
  Transport: '/transport/',
  Station: '/station/',
  Outline: '/outlines/',
  Organization: '/organization/',
  EquipmentType: '/equipment/',
}

export interface SlugHit { path: string; label: string; slug: string }

/** The slug with capitals, punctuation and leading zeros taken out: `AX-013`, `ax13` and `ax-13` agree. */
export function slugKey(slug: string): string {
  return slug.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/([a-z])0+(\d)/g, '$1$2')
}

/**
 * The same key with up to three zeros put back after a letter, in every
 * place a letter meets a digit: `ax13` → `ax13`, `ax013`, `ax0013`, …
 * (the database cannot strip zeros itself, so the candidates are listed).
 */
export function zeroVariants(key: string): string[] {
  const parts = key.split(/(?<=[a-z])(?=\d)/)   // 'ax13' → ['ax', '13']
  if (parts.length === 1) return [key]
  const boundaries = parts.length - 1
  if (boundaries > 3) return [key]
  let out = [parts[0]]
  for (let i = 1; i < parts.length; i++) {
    const next: string[] = []
    for (const head of out) for (let z = 0; z <= 3; z++) next.push(head + '0'.repeat(z) + parts[i])
    out = next
  }
  return out
}

const KINDS = Object.keys(KIND_ROUTES).map(l => `n:${l}`).join(' OR ')

/** The slug as the database spells it, hyphens and the like removed, to compare with the keys. */
const FLAT = "toLower(replace(replace(replace(replace(replace(n.slug, '-', ''), ' ', ''), '_', ''), '.', ''), '/', ''))"

const CYPHER = `
  MATCH (n) WHERE n.slug IS NOT NULL AND (${KINDS})
    AND (n.slug = $exact OR ${FLAT} IN $keys)
  RETURN labels(n)[0] AS label, n.slug AS slug
  LIMIT 40`

/** A page that can be a link target: its kind and slug, or an old slug that now leads to `target`. */
export interface SlugRow { label: string; slug: string; target?: string }

export type SlugMatch =
  | { kind: 'hit'; hit: SlugHit }
  | { kind: 'ambiguous'; candidates: SlugHit[] }
  | { kind: 'none' }

const hitOf = (r: SlugRow): SlugHit => {
  const slug = r.target ?? r.slug
  return { path: KIND_ROUTES[r.label] + encodeURIComponent(slug), label: r.label, slug }
}

/**
 * Which page `slug` means among `rows`: the one with exactly that slug, else
 * the one whose slug differs only in spelling. More than one is ambiguous.
 */
export function matchSlug(rows: SlugRow[], slug: string): SlugMatch {
  const exact = slug.trim()
  const key = slugKey(exact)
  if (!key) return { kind: 'none' }
  const known = rows.filter(r => KIND_ROUTES[r.label])

  const pick = (candidates: SlugRow[]): SlugMatch => {
    const distinct = new Map(candidates.map(c => { const h = hitOf(c); return [`${h.label}:${h.slug}`, h] }))
    if (distinct.size === 1) return { kind: 'hit', hit: [...distinct.values()][0] }
    return distinct.size ? { kind: 'ambiguous', candidates: [...distinct.values()] } : { kind: 'none' }
  }

  const sameSlug = known.filter(r => r.slug === exact)
  if (sameSlug.length) return pick(sameSlug)
  return pick(known.filter(r => slugKey(r.slug) === key))
}

/** Where `slug` should lead, or null when no single page can be named. */
export async function resolveSlug(slug: string, query: QueryFn): Promise<SlugHit | null> {
  const exact = slug.trim()
  const key = slugKey(exact)
  if (!key) return null

  const rows = (await query(CYPHER, { exact, keys: zeroVariants(key) }))
    .map(r => ({ label: String(r.label), slug: String(r.slug) }))
  const m = matchSlug(rows, exact)
  return m.kind === 'hit' ? m.hit : null
}
