/**
 * Direct Cypher generation for schema-simple types (no Claude needed).
 *
 * organization: name + color  → (:Organization)
 * district:     name only     → (:Unit)
 *
 * Parses the Sanity `name` field into four Neo4j properties:
 *   name         – display name (abbreviation if available, else short name)
 *   formalName   – full formal name (if distinguishable from name)
 *   abbreviation – short form / acronym (if present)
 *   sortingName  – original sort-prefixed string (if it had a numeric prefix)
 *
 * Run with: npx tsx scripts/generate-simple-cypher.ts
 * Output:   data/cypher/organization.cypher
 *           data/cypher/district.cypher
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { resolve } from 'path'

const DATA_DIR   = resolve(process.cwd(), 'data')
const CYPHER_DIR = resolve(DATA_DIR, 'cypher')

function esc(val: string): string {
  return val.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'aa')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

interface ParsedName {
  name: string
  slug: string
  formalName: string | null
  abbreviation: string | null
  sortingName: string | null
}

/**
 * Strip numeric sort prefix ("03-Milorg" → "Milorg", sortingName = "03-Milorg")
 * Then split on " - " for abbreviation/formal pairs where recognisable.
 */
function parseName(raw: string): ParsedName {
  let sortingName: string | null = null
  let base = raw.trim()

  // Strip sort prefix: "03-Milorg", "01- SIS-XU", "06 Skøyter ikke organisert"
  const sortMatch = base.match(/^(\d{2}[-\s]+)(.+)$/)
  if (sortMatch) {
    sortingName = base
    base = sortMatch[2].trim()
  }

  // Known manual overrides where the pattern isn't mechanical
  const overrides: Record<string, Omit<ParsedName, 'sortingName'>> = {
    'NNIU - Norwegian Naval Independent Unit': {
      name: 'NNIU',
      formalName: 'Norwegian Naval Independent Unit',
      abbreviation: 'NNIU',
    },
    'FO IV - MI 4': {
      name: 'FO IV',
      formalName: 'Forsvarets Overkommando IV - Militær Innsats 4',
      abbreviation: 'FO IV',
    },
    'RNNSU  Royal Norwegian Naval Special Unit': {
      name: 'RNNSU',
      formalName: 'Royal Norwegian Naval Special Unit',
      abbreviation: 'RNNSU',
    },
    'NOR.I.C.1 Kompani Linge': {
      name: 'Kompani Linge',
      formalName: 'NOR.I.C.1 Kompani Linge',
      abbreviation: 'NOR.I.C.1',
    },
    'MSP Marinens skøyteavdeling Petershead': {
      name: 'MSP Marinens skøyteavdeling Petershead',
      formalName: 'Marinens skøyteavdeling Petershead',
      abbreviation: 'MSP',
    },
    'MK Skøyter': {
      name: 'MK Skøyter',
      formalName: 'Marinekommando Skøyter',
      abbreviation: 'MK',
    },
    'MTB flåten': {
      name: 'MTB-flåten',
      formalName: 'Motor Torpedo Boat-flåten',
      abbreviation: 'MTB',
    },
    'BOAC/BALDER': {
      name: 'BOAC/BALDER',
      formalName: 'British Overseas Airways Corporation / BALDER',
      abbreviation: 'BOAC',
    },
    'Hærens Overkommando i London HOK': {
      name: 'HOK',
      formalName: 'Hærens Overkommando i London',
      abbreviation: 'HOK',
    },
    'RAF/RCAF/RAAF/RNZAF': {
      name: 'RAF/RCAF/RAAF/RNZAF',
      formalName: 'Royal Air Force / Royal Canadian AF / Royal Australian AF / Royal New Zealand AF',
      abbreviation: 'RAF',
    },
    'SIS': {
      name: 'SIS',
      formalName: 'Secret Intelligence Service',
      abbreviation: 'SIS',
    },
    'SOE': {
      name: 'SOE',
      formalName: 'Special Operations Executive',
      abbreviation: 'SOE',
    },
    'SIS-XU': {
      name: 'SIS-XU',
      formalName: 'Secret Intelligence Service - XU',
      abbreviation: 'SIS-XU',
    },
    'ANGLO-NORWEGIAN COLLABORATION COMMITTEE': {
      name: 'ANCC',
      formalName: 'Anglo-Norwegian Collaboration Committee',
      abbreviation: 'ANCC',
    },
    'R-Gruppen - SS (Rognes) Party - forløpere for SL': {
      name: 'R-Gruppen',
      formalName: 'R-Gruppen - SS (Rognes) Party - forløpere for Sentralledelsen',
      abbreviation: null,
    },
  }

  // Check overrides (trim trailing whitespace from Sanity data)
  const trimmed = base.replace(/\s+$/, '')
  if (overrides[trimmed]) {
    const o = overrides[trimmed]
    return { ...o, slug: slugify(o.name), sortingName }
  }

  // For remaining entries: just set name, leave formal/abbreviation null
  return {
    name: base,
    slug: slugify(base),
    formalName: null,
    abbreviation: null,
    sortingName,
  }
}

function setLine(prop: string, val: string | null, varName: string): string {
  if (val == null) return ''
  return `\nSET ${varName}.${prop} = "${esc(val)}"`
}

function generateOrganization(docs: Record<string, unknown>[]): string {
  return docs.map(doc => {
    const id      = doc['_id'] as string
    const raw     = doc['name'] as string ?? ''
    const parsed  = parseName(raw)
    const color   = doc['color'] as Record<string, unknown> | undefined
    const hex     = color?.['hex'] ? esc(color['hex'] as string) : null

    return `// ── ${id} ──
MERGE (src:Source {sanityId: "${id}", blockKey: "root"})
SET src.extractedAt = datetime()

MERGE (org:Organization {sanityId: "${id}"})
SET org.name = "${esc(parsed.name)}"
SET org.slug = "${esc(parsed.slug)}"${setLine('formalName', parsed.formalName, 'org')}${setLine('abbreviation', parsed.abbreviation, 'org')}${setLine('sortingName', parsed.sortingName, 'org')}${hex ? `\nSET org.color = "${hex}"` : ''}

MERGE (org)-[:EXTRACTED_FROM]->(src);`
  }).join('\n\n')
}

function generateDistrict(docs: Record<string, unknown>[]): string {
  return docs.map(doc => {
    const id     = doc['_id'] as string
    const raw    = doc['name'] as string ?? ''
    const parsed = parseName(raw)

    return `// ── ${id} ──
MERGE (src:Source {sanityId: "${id}", blockKey: "root"})
SET src.extractedAt = datetime()

MERGE (u:Unit {sanityId: "${id}"})
SET u.name = "${esc(parsed.name)}"
SET u.slug = "${esc(parsed.slug)}"${setLine('formalName', parsed.formalName, 'u')}${setLine('abbreviation', parsed.abbreviation, 'u')}${setLine('sortingName', parsed.sortingName, 'u')}

MERGE (u)-[:EXTRACTED_FROM]->(src);`
  }).join('\n\n')
}

function generate(type: string, fn: (docs: Record<string, unknown>[]) => string) {
  const file = resolve(DATA_DIR, `sanity-${type}.json`)
  const docs = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>[]
  const cypher = fn(docs)
  const out = resolve(CYPHER_DIR, `${type}.cypher`)
  writeFileSync(out, cypher + '\n')
  console.log(`  Wrote ${docs.length} blocks → data/cypher/${type}.cypher`)
}

mkdirSync(CYPHER_DIR, { recursive: true })
generate('organization', generateOrganization)
generate('district',     generateDistrict)
console.log('Done.')
