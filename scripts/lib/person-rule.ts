/**
 * The Sanity → graph rule for people, ported from the Clojure migration so
 * the sync maps new and changed documents exactly as the original import
 * did (docs/SANITY-SYNC.md: "an unchanged rule keeps the old mapping").
 *
 *   parsePerson    ← migration/src/linge/parse.clj   (parse-person)
 *   personClaims   ← migration/src/linge/round_one.clj (person-cypher, person-rank-edges)
 *   linkSource     ← migration/src/linge/external_sources.clj
 *   imageSource    ← migration/src/linge/galleries.clj
 *
 * `scripts/sync/sync-person.ts --check` proves the port: applied to the April
 * baseline it must reproduce the graph for every unchanged person. Keep
 * the two in step — if a rule changes here, the check says whether the
 * existing graph still matches it.
 */

// ── parse.clj ─────────────────────────────────────────────────────────────

export const RANKS: Record<string, { abbrs: string[]; tier: number; org: string }> = {
  'Menig':             { abbrs: ['Menig'],                                    tier: 1, org: 'haeren' },
  'Korporal':          { abbrs: ['Korporal', 'Korp', 'Korp.', 'Cpl', 'Cpl.'], tier: 2, org: 'haeren' },
  'Sersjant':          { abbrs: ['Sersjant', 'Sgt', 'Sgt.', 'Sjt', 'Sers.', 'Sers'], tier: 3, org: 'haeren' },
  'Fenrik':            { abbrs: ['Fenrik', 'Fenr', 'Fenr.'],                  tier: 4, org: 'haeren' },
  'Løytnant':          { abbrs: ['Løytnant', 'Lt', 'Lt.'],                    tier: 5, org: 'haeren' },
  'Kaptein':           { abbrs: ['Kaptein', 'Kapt', 'Kapt.'],                 tier: 6, org: 'haeren' },
  'Major':             { abbrs: ['Major'],                                    tier: 7, org: 'haeren' },
  'Oberst':            { abbrs: ['Oberst'],                                   tier: 8, org: 'haeren' },
  'Pilot Officer':     { abbrs: ['P/O'],                                      tier: 3, org: 'raf' },
  'Flying Officer':    { abbrs: ['F/O'],                                      tier: 4, org: 'raf' },
  'Flight Lieutenant': { abbrs: ['F/Lt', 'Flt'],                              tier: 5, org: 'raf' },
  'Warrant Officer':   { abbrs: ['W/O'],                                      tier: 3, org: 'raf' },
  'Sub Lieutenant':    { abbrs: ['S/Lt', 'S/Lt.'],                            tier: 4, org: 'marinen' },
  'Second Lieutenant': { abbrs: ['2Lt', '2/Lt'],                              tier: 4, org: 'usaaf' },
}

const ABBR_TO_RANK = new Map(
  Object.entries(RANKS).flatMap(([canonical, { abbrs }]) => abbrs.map(a => [a.toLowerCase(), canonical] as const)),
)

/** Abbreviations that mean another rank as the name's first token. Jan writes
 *  American airmen rank-first ("S/Lt. Davis Jere L" — Second Lieutenant) and
 *  Norwegians rank-last ("Jan Helen S/Lt" — Sub Lieutenant, navy). */
const LEADING_ABBR_TO_RANK = new Map([['s/lt', 'Second Lieutenant'], ['s/lt.', 'Second Lieutenant']])

const STATUS_MARKERS: [string, string][] = [['✝', 'KIA'], ['∞', 'ambiguous']]
const ORG_FLAGS = ['NNIU', 'KS']

const normalizeWs = (s: string) => s.replace(/\t/g, ' ').replace(/\s+/g, ' ').trim()
const escapeRe    = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export interface ParsedPerson {
  canonicalName: string
  rank:   { canonical: string; original: string } | null
  status: { value: string; marker: string } | null
  flags:  string[]
}

export function parsePerson(name: string): ParsedPerson {
  const normalized = normalizeWs(name)

  let status: ParsedPerson['status'] = null
  let afterStatus = normalized
  for (const [marker, value] of STATUS_MARKERS) {
    if (normalized.includes(marker)) {
      status = { value, marker }
      afterStatus = normalized.replace(new RegExp(`\\s*${escapeRe(marker)}\\s*`, 'g'), ' ')
      break
    }
  }

  const flags: string[] = []
  let remainder = afterStatus
  for (const flag of ORG_FLAGS) {
    const re = new RegExp(`\\s*\\(?${flag}\\)?\\s*`, 'g')
    if (re.test(remainder)) {
      flags.push(flag)
      remainder = remainder.replace(new RegExp(`\\s*\\(?${flag}\\)?\\s*`, 'g'), ' ')
    }
  }

  const tokens = remainder.trim().split(/\s+/)
  let rank: ParsedPerson['rank'] = null
  let rankRemainder = remainder
  for (let i = 0; i < tokens.length; i++) {
    const canonical = (i === 0 && LEADING_ABBR_TO_RANK.get(tokens[i].toLowerCase())) || ABBR_TO_RANK.get(tokens[i].toLowerCase())
    if (canonical) {
      rank = { canonical, original: tokens[i] }
      rankRemainder = [...tokens.slice(0, i), ...tokens.slice(i + 1)].join(' ')
      break
    }
  }

  return { canonicalName: normalizeWs(rankRemainder), rank, status, flags }
}

// ── round_one.clj ─────────────────────────────────────────────────────────

export function slugify(s: string): string {
  return s.toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'aa')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '')
}

export const sanMigRef = (type: string, sanityId: string, field: string) =>
  `sanity-migration:${type}:${sanityId}:${field}`

/** The known rank (RANK edge) + sourceRef: the parsed rank, or Menig by default. */
export function rankEdge(sanityId: string, parsed: ParsedPerson): { rankSlug: string; sourceRef: string } {
  return parsed.rank
    ? { rankSlug: slugify(parsed.rank.canonical), sourceRef: sanMigRef('person', sanityId, 'name:rank-token') }
    : { rankSlug: 'menig',                        sourceRef: sanMigRef('person', sanityId, 'default:menig-soldier-baseline') }
}

/** Scalar claims as node properties: `<field>`, `<field>_state`, `<field>_sourceRef`. */
export function personClaims(sanityId: string, doc: Record<string, unknown> & { birthYear?: unknown; home?: unknown; secretName?: unknown }, parsed: ParsedPerson): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const claim = (field: string, value: unknown, ref: string) => {
    out[field] = value
    out[`${field}_state`] = 'candidate'
    out[`${field}_sourceRef`] = sanMigRef('person', sanityId, ref)
  }
  if (doc.birthYear != null && doc.birthYear !== '') claim('birthYear', doc.birthYear, 'birthYear')
  if (parsed.status) claim('status', parsed.status.value, `name-marker:${parsed.status.marker}`)
  if (doc.home) claim('home', doc.home, 'home')
  if (doc.secretName) claim('secretName', doc.secretName, 'secretName')
  // serviceClass=military only when a rank token was parsed from the name.
  if (parsed.rank) claim('serviceClass', 'military', 'rank-parsed-from-name')
  return out
}

// ── external_sources.clj ──────────────────────────────────────────────────

const DOMAIN_TYPE: Record<string, string> = {
  'nb.no': 'book', 'lokalhistoriewiki.no': 'encyclopedia', 'no.wikipedia.org': 'encyclopedia',
  'en.wikipedia.org': 'encyclopedia', 'krigsseilerregisteret.no': 'registry', 'fanger.no': 'registry',
  'warsailors.com': 'registry', 'uboat.net': 'registry', 'scramble.no': 'reference',
  'asn.flightsafety.org': 'registry', 'media.digitalarkivet.no': 'archive',
  'ueaeprints.uea.ac.uk': 'academic', 'dora.dmu.ac.uk': 'academic', 'youtube.com': 'video',
  'youtu.be': 'video', 'vg.no': 'newspaper', 'nrk.no': 'newspaper', 'google.com': 'map',
  'spycom.org': 'website', 'pax.no': 'publisher',
}
const NB_BACKED = new Set(['nb.no', 'lokalhistoriewiki.no', 'media.digitalarkivet.no', 'krigsseilerregisteret.no'])
const DOMAIN_LICENSE: Record<string, string> = {
  'lokalhistoriewiki.no': 'CC-BY-SA-3.0+GFDL', 'no.wikipedia.org': 'CC-BY-SA-4.0',
  'en.wikipedia.org': 'CC-BY-SA-4.0', 'nb.no': 'copyright', 'media.digitalarkivet.no': 'varies',
}
const DOMAIN_ATTRIBUTION: Record<string, string> = {
  'lokalhistoriewiki.no': 'Lokalhistoriewiki, Nasjonalbiblioteket', 'no.wikipedia.org': 'Wikipedia (no)',
  'en.wikipedia.org': 'Wikipedia (en)', 'nb.no': 'Nasjonalbiblioteket',
  'media.digitalarkivet.no': 'Arkivverket / Digitalarkivet', 'krigsseilerregisteret.no': 'Krigsseilerregisteret',
  'fanger.no': 'Fangeregisteret',
}

/** Links the original import took: the raw URL (untrimmed — a leading
 *  space made the Clojure `re-matches` fail) must be http(s) throughout. */
export const isImportableUrl = (url: string) => /^https?:\/\/.*$/i.test(url)

export function extractDomain(url: string): string | null {
  const m = /^https?:\/\/(?:www\.)?([^/?#]+)/i.exec(url)
  return m ? m[1].toLowerCase() : null
}

/** Java String.hashCode — the Clojure id suffix. */
function javaHash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return h
}

/** Deterministic Source id per URL (external_sources.clj url->id). */
export function urlToId(url: string): string {
  const domain = extractDomain(url) ?? ''
  const path = url
    .replace(new RegExp(`^https?://(?:www\\.)?${escapeRe(domain)}`), '')
    .replace(/\?.*$/s, '')
    .replace(/#.*$/s, '')
  const body = (domain + path).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '')
  const hash = (Math.abs(javaHash(url)) >>> 0).toString(16).padStart(8, '0')
  return `${body.slice(0, 100)}-${hash}`
}

export interface LinkSource {
  id: string; url: string; type: string; domain: string | null
  title?: string; nbBacked?: true; license?: string; attribution?: string
}

export function linkSource(url: string, title: string | undefined): LinkSource {
  const domain = extractDomain(url)
  const d = domain ?? ''
  const src: LinkSource = { id: urlToId(url), url, type: DOMAIN_TYPE[d] ?? 'website', domain }
  if (title) src.title = title
  if (NB_BACKED.has(d)) src.nbBacked = true
  if (DOMAIN_LICENSE[d]) src.license = DOMAIN_LICENSE[d]
  if (DOMAIN_ATTRIBUTION[d]) src.attribution = DOMAIN_ATTRIBUTION[d]
  return src
}

// ── galleries.clj ─────────────────────────────────────────────────────────

const SANITY_CDN = 'https://cdn.sanity.io/images/7r6kqtqy/production'

export interface ImageSource { id: string; url: string; assetRef: string; order: number; caption?: string }

export function imageSources(gallery: unknown): ImageSource[] {
  if (!Array.isArray(gallery)) return []
  const out: ImageSource[] = []
  gallery.forEach((item: { asset?: { _ref?: string }; caption?: unknown }, idx) => {
    const ref = item.asset?._ref
    const m = ref ? /^image-([a-f0-9]+)-(\d+x\d+)-(\w+)$/.exec(ref) : null
    if (!ref || !m) return
    const img: ImageSource = { id: `img:sanity:${ref}`, url: `${SANITY_CDN}/${m[1]}-${m[2]}.${m[3]}`, assetRef: ref, order: idx + 1 }
    if (typeof item.caption === 'string' && item.caption) img.caption = item.caption
    out.push(img)
  })
  return out
}
