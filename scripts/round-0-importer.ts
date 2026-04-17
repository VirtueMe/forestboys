/**
 * Round-0 importer — Kompani Linge vertical prototype seed.
 *
 * Reads from local Sanity JSON dumps and emits Cypher for a minimum viable
 * graph over the Linge slice:
 *
 *   - 4× Organization   (SOE, Kompani Linge, Hæren, RAF)
 *   - 5× Source         (4 NBN URN books from Linge's links[] + sanity-migration)
 *   - ~N× Rank          (unique ranks parsed from person names; linked to issuing org)
 *   - 272× Person       (every scalar claim carries {value, state, sourceRef})
 *   - MEMBER_OF edges   (person → Kompani Linge, verified, from Linge outline)
 *   - HELD_RANK edges   (person → Rank, candidate, from sanity-migration)
 *
 * Output lives in data/round-0/ — separate from data/cypher/ and data/cypher-clean/
 * so it won't collide with the parallel isolated-extraction import pipeline.
 *
 * Run: npx tsx scripts/round-0-importer.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { resolve } from 'path'

const DATA_DIR = resolve(process.cwd(), 'data')
const OUT_DIR = resolve(DATA_DIR, 'round-0')

// ──────────────────────────────────────────────────────────────────────────────
// Rank table. Canonical name → { abbreviations, tier, issuing org slug }.
// Deliberately small for round 0 — enough to cover the Linge roster.
// Jan promotes / corrects these via the editor later; this is the candidate seed.

const RANKS: Record<string, { abbr: string[]; tier: number; org: string }> = {
  // Norwegian Army (Hæren)
  Menig:      { abbr: ['Menig'],                               tier: 1, org: 'haeren' },
  Korporal:   { abbr: ['Korporal', 'Korp', 'Korp.', 'Cpl', 'Cpl.'], tier: 2, org: 'haeren' },
  Sersjant:   { abbr: ['Sersjant', 'Sgt', 'Sgt.', 'Sjt', 'Sers.', 'Sers'], tier: 3, org: 'haeren' },
  Fenrik:     { abbr: ['Fenrik', 'Fenr', 'Fenr.'],             tier: 4, org: 'haeren' },
  Løytnant:   { abbr: ['Løytnant', 'Lt', 'Lt.'],               tier: 5, org: 'haeren' },
  Kaptein:    { abbr: ['Kaptein', 'Kapt', 'Kapt.'],            tier: 6, org: 'haeren' },
  Major:      { abbr: ['Major'],                               tier: 7, org: 'haeren' },
  Oberst:     { abbr: ['Oberst'],                              tier: 8, org: 'haeren' },
  // RAF / Commonwealth air forces (used for ~70 non-Norwegian persons in Linge slice)
  'Pilot Officer':      { abbr: ['P/O'],                       tier: 3, org: 'raf' },
  'Flying Officer':     { abbr: ['F/O'],                       tier: 4, org: 'raf' },
  'Flight Lieutenant':  { abbr: ['F/Lt', 'Flt'],               tier: 5, org: 'raf' },
  'Warrant Officer':    { abbr: ['W/O'],                       tier: 3, org: 'raf' },
  // Norwegian Navy
  'Sub Lieutenant':     { abbr: ['S/Lt'],                      tier: 4, org: 'marinen' },
}

// Flat lookup: abbreviation → canonical rank name
const ABBR_TO_CANONICAL: Record<string, string> = {}
for (const [canonical, { abbr }] of Object.entries(RANKS)) {
  for (const a of abbr) ABBR_TO_CANONICAL[a.toLowerCase()] = canonical
}

// ──────────────────────────────────────────────────────────────────────────────
// Status marker extraction. Symbols appended to person names.
//   ✝  → killed (confident → KIA, candidate state pending Jan's ✓)
//   ∞  → ambiguous — missing / perished at sea / other (needs Jan to resolve)
//   NNIU, KS → organizational affiliations, not statuses (handled separately)

const STATUS_MARKERS: Record<string, string> = {
  '✝': 'KIA',
  '∞': 'ambiguous', // TODO: Jan to classify; placeholder for round 0
}

// ──────────────────────────────────────────────────────────────────────────────
// Types

interface SanityRef { _ref: string; _type: 'reference'; _key?: string }
interface SanityPerson {
  _id: string
  _updatedAt: string
  name: string
  slug: { current: string }
  birthYear?: number
  home?: string
  secretName?: string
  description?: unknown[]
}

interface ParsedPerson {
  sanityId: string
  sanityUpdatedAt: string
  rawName: string
  canonicalName: string
  slug: string
  rank: { canonical: string; original: string } | null
  status: { value: string; markerChar: string } | null
  flags: string[] // NNIU, KS, etc.
  birthYear?: number
  home?: string
  secretName?: string
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function slugify(s: string): string {
  return s.toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'aa')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function parsePerson(p: SanityPerson): ParsedPerson {
  const raw = p.name
  let working = raw.replace(/\s+/g, ' ').replace(/\t/g, ' ').trim()
  const flags: string[] = []

  // Extract status markers (one-char unicode)
  let status: ParsedPerson['status'] = null
  for (const [marker, value] of Object.entries(STATUS_MARKERS)) {
    if (working.includes(marker)) {
      status = { value, markerChar: marker }
      working = working.replace(new RegExp(`\\s*${marker}\\s*`, 'g'), ' ').trim()
    }
  }

  // Extract organizational-affiliation flags (handled as separate MEMBER_OF edges later)
  for (const flag of ['NNIU', 'KS', '(KS)']) {
    const re = new RegExp(`\\s*${flag.replace(/[()]/g, '\\$&')}\\s*`, 'g')
    if (working.match(re)) {
      flags.push(flag.replace(/[()]/g, ''))
      working = working.replace(re, ' ').trim()
    }
  }

  // Extract rank (match longest token first)
  const tokens = working.split(/\s+/)
  let rank: ParsedPerson['rank'] = null
  // Check each token in both start and end positions (rank often at end, sometimes start)
  for (let i = 0; i < tokens.length; i++) {
    const canonical = ABBR_TO_CANONICAL[tokens[i].toLowerCase()]
    if (canonical) {
      rank = { canonical, original: tokens[i] }
      tokens.splice(i, 1)
      break
    }
  }
  const canonicalName = tokens.join(' ').replace(/\s+/g, ' ').trim()

  return {
    sanityId: p._id,
    sanityUpdatedAt: p._updatedAt,
    rawName: raw,
    canonicalName,
    slug: p.slug.current,
    rank,
    status,
    flags,
    birthYear: p.birthYear,
    home: p.home,
    secretName: p.secretName,
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Cypher emitters. Each returns a string (one or more statements).

function cypherOrg(slug: string, canonicalName: string, type: string, country: string, extra: Record<string, unknown> = {}): string {
  const props: string[] = [
    `slug: "${esc(slug)}"`,
    `canonicalName: "${esc(canonicalName)}"`,
    `type: "${esc(type)}"`,
    `country: "${esc(country)}"`,
  ]
  for (const [k, v] of Object.entries(extra)) {
    if (v == null) continue
    if (typeof v === 'string') props.push(`${k}: "${esc(v)}"`)
    else props.push(`${k}: ${JSON.stringify(v)}`)
  }
  return `MERGE (:Organization {${props.join(', ')}});\n`
}

function cypherSource(id: string, title: string, type: string, extra: Record<string, unknown> = {}): string {
  const props: string[] = [
    `id: "${esc(id)}"`,
    `title: "${esc(title)}"`,
    `type: "${esc(type)}"`,
  ]
  for (const [k, v] of Object.entries(extra)) {
    if (v == null) continue
    if (typeof v === 'string') props.push(`${k}: "${esc(v)}"`)
    else props.push(`${k}: ${JSON.stringify(v)}`)
  }
  return `MERGE (:Source {${props.join(', ')}});\n`
}

function cypherRank(canonical: string, abbr: string, tier: number, orgSlug: string): string {
  const slug = slugify(canonical)
  return (
    `MERGE (:Rank {slug: "${slug}", canonicalName: "${esc(canonical)}", abbreviation: "${esc(abbr)}", tier: ${tier}});\n` +
    `MATCH (r:Rank {slug: "${slug}"}), (o:Organization {slug: "${esc(orgSlug)}"})\n` +
    `MERGE (r)-[:IN]->(o);\n`
  )
}

function cypherPerson(pp: ParsedPerson): string {
  // Scalar claims use paired properties: foo, foo_state, foo_sourceRef.
  // sanity-migration pseudo-source covers all round-0 candidate values.
  const sanMigRef = (field: string) => `sanity-migration:person:${pp.sanityId}:${field}`

  const props: string[] = [
    `slug: "${esc(pp.slug)}"`,
    `canonicalName: "${esc(pp.canonicalName)}"`,
    `sanityId: "${esc(pp.sanityId)}"`,
    `sanityUpdatedAt: "${esc(pp.sanityUpdatedAt)}"`,
  ]

  if (pp.birthYear != null) {
    props.push(`birthYear: ${pp.birthYear}`)
    props.push(`birthYear_state: "candidate"`)
    props.push(`birthYear_sourceRef: "${sanMigRef('birthYear')}"`)
  } else {
    props.push(`birthYear_state: "unknown"`)
  }

  if (pp.status) {
    props.push(`status: "${esc(pp.status.value)}"`)
    props.push(`status_state: "candidate"`)
    props.push(`status_sourceRef: "${sanMigRef(`name-marker:${pp.status.markerChar}`)}"`)
  } else {
    props.push(`status_state: "unknown"`)
  }

  if (pp.home) {
    props.push(`home: "${esc(pp.home)}"`)
    props.push(`home_state: "candidate"`)
    props.push(`home_sourceRef: "${sanMigRef('home')}"`)
  }

  if (pp.secretName) {
    props.push(`secretName: "${esc(pp.secretName)}"`)
    props.push(`secretName_state: "candidate"`)
    props.push(`secretName_sourceRef: "${sanMigRef('secretName')}"`)
  }

  return `MERGE (:Person {${props.join(', ')}});\n`
}

function cypherMembership(personSlug: string, orgSlug: string, sourceRef: string, state: string): string {
  return (
    `MATCH (p:Person {slug: "${esc(personSlug)}"}), (o:Organization {slug: "${esc(orgSlug)}"})\n` +
    `MERGE (p)-[r:MEMBER_OF]->(o)\n` +
    `ON CREATE SET r.state = "${state}", r.sourceRef = "${esc(sourceRef)}";\n`
  )
}

function cypherHeldRank(personSlug: string, rankSlug: string, sourceRef: string): string {
  return (
    `MATCH (p:Person {slug: "${esc(personSlug)}"}), (r:Rank {slug: "${esc(rankSlug)}"})\n` +
    `MERGE (p)-[h:HELD_RANK]->(r)\n` +
    `ON CREATE SET h.state = "candidate", h.sourceRef = "${esc(sourceRef)}";\n`
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Main

function main() {
  const outlines = JSON.parse(readFileSync(resolve(DATA_DIR, 'sanity-outline.json'), 'utf8'))
  const persons = JSON.parse(readFileSync(resolve(DATA_DIR, 'sanity-person.json'), 'utf8')) as SanityPerson[]
  const personById = new Map(persons.map((p) => [p._id, p]))

  const linge = outlines.find((o: { title?: string }) => o.title?.includes('N.O.R.I.C'))
  if (!linge) throw new Error('Linge outline not found')

  const refs = (linge.people ?? []) as SanityRef[]
  const resolved: SanityPerson[] = refs.map((r) => personById.get(r._ref)).filter((x): x is SanityPerson => Boolean(x))

  console.log(`Resolved ${resolved.length}/${refs.length} Linge members from sanity-person.json`)

  const parsed = resolved.map(parsePerson)

  // ── 00: Organizations (SOE parent, Linge, issuing militaries for ranks)
  let orgs = ''
  orgs += cypherOrg('soe', 'SOE', 'allied-agency', 'UK', { foundedDate: '1940-07-22', dissolvedDate: '1946-01-15' })
  orgs += cypherOrg('kompani-linge', 'Kompani Linge', 'military-unit', 'UK-NO', {
    color: '#e35c24',
    foundedDate: '1940-08-01',
    // names[] as JSON-encoded string — proper sub-node modeling deferred
    names: JSON.stringify([
      { value: 'Norwegian Independent Company 1', type: 'formal', language: 'en', period: '1941–1945', context: 'SOE' },
      { value: 'NOR.I.C.1', type: 'formal-cover', language: 'en' },
      { value: 'Kompani Linge', type: 'primary', language: 'no' },
    ]),
  })
  orgs += `MATCH (c:Organization {slug: "kompani-linge"}), (p:Organization {slug: "soe"})\n`
  orgs += `MERGE (c)-[:PART_OF]->(p);\n`
  orgs += cypherOrg('haeren', 'Hæren', 'military-branch', 'NO')
  orgs += cypherOrg('raf', 'RAF', 'military-branch', 'UK')
  orgs += cypherOrg('marinen', 'Marinen', 'military-branch', 'NO')

  // ── 01: Sources (4 NBN books from Linge.links[] + sanity-migration pseudo)
  let sources = ''
  sources += cypherSource('sanity-migration', 'Sanity migration 2026-04-17', 'migration-origin', {
    note: 'Synthetic source for round-0 auto-extracted claims. Upgrade via verification.',
  })
  for (const link of linge.links ?? []) {
    const urnMatch = link.link?.match(/URN:NBN:([^?&]+)/)
    if (!urnMatch) continue
    const id = `urn-nbn-${urnMatch[1]}`
    const yearMatch = link.title?.match(/\b(19|20)\d{2}\b/)
    sources += cypherSource(id, String(link.title ?? '').trim(), 'book', {
      identifier: `URN:NBN:${urnMatch[1]}`,
      publishedDate: yearMatch ? yearMatch[0] : null,
      url: link.link,
    })
  }

  // ── 02: Ranks (only those actually seen in the Linge roster)
  const seenRanks = new Set<string>()
  for (const pp of parsed) if (pp.rank) seenRanks.add(pp.rank.canonical)

  let ranks = ''
  for (const canonical of seenRanks) {
    const def = RANKS[canonical]
    ranks += cypherRank(canonical, def.abbr[0], def.tier, def.org)
  }

  // ── 03: Persons
  let personCypher = ''
  for (const pp of parsed) personCypher += cypherPerson(pp)

  // ── 04: Relationships (MEMBER_OF Linge, HELD_RANK)
  let rels = ''
  for (const pp of parsed) {
    rels += cypherMembership(pp.slug, 'kompani-linge', 'linge-outline-membership', 'verified')
    if (pp.rank) {
      rels += cypherHeldRank(pp.slug, slugify(pp.rank.canonical), `sanity-migration:person:${pp.sanityId}:name:rank-token`)
    }
    // NNIU / KS flags → additional MEMBER_OF edges (round 1 work; flagged here)
    // TODO: create Organization nodes for NNIU, KS and emit MEMBER_OF edges
  }

  // ── write
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(resolve(OUT_DIR, '00-organizations.cypher'), orgs)
  writeFileSync(resolve(OUT_DIR, '01-sources.cypher'), sources)
  writeFileSync(resolve(OUT_DIR, '02-ranks.cypher'), ranks)
  writeFileSync(resolve(OUT_DIR, '03-persons.cypher'), personCypher)
  writeFileSync(resolve(OUT_DIR, '04-relationships.cypher'), rels)

  // ── report
  const byRank = new Map<string, number>()
  for (const pp of parsed) {
    const r = pp.rank?.canonical ?? '(no rank)'
    byRank.set(r, (byRank.get(r) ?? 0) + 1)
  }
  const statusCount = parsed.filter((p) => p.status).length
  const flagCount = parsed.filter((p) => p.flags.length).length

  console.log(`\n--- Round-0 report ---`)
  console.log(`Persons:         ${parsed.length}`)
  console.log(`With rank:       ${parsed.filter((p) => p.rank).length} (${seenRanks.size} unique)`)
  console.log(`With status:     ${statusCount} (✝/∞)`)
  console.log(`With flags:      ${flagCount} (NNIU/KS — round-1 work)`)
  console.log(`\nRank distribution:`)
  for (const [r, n] of [...byRank.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(3)}  ${r}`)
  }
  console.log(`\nOutput: ${OUT_DIR}/`)
  console.log(`Files: 00-organizations / 01-sources / 02-ranks / 03-persons / 04-relationships`)
}

main()
