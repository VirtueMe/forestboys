/**
 * Direct Cypher generation for schema-simple types (no Claude needed).
 *
 * organization: name + color  → (:Organization)
 * district:     name only     → (:Unit)
 *
 * Run with: npx tsx scripts/generate-simple-cypher.ts
 * Output:   data/cypher/organization.cypher
 *           data/cypher/district.cypher
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { resolve } from 'path'

const DATA_DIR   = resolve(process.cwd(), 'data')
const CYPHER_DIR = resolve(DATA_DIR, 'cypher')

function escape(val: string): string {
  return val.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

// Split "NN-Real Name" into { sortName: "NN-Real Name", displayName: "Real Name" }
// Names without a numeric prefix are returned as-is for both fields.
function splitOrgName(raw: string): { displayName: string; sortName: string | null } {
  const m = raw.match(/^(\d{2}-\d{2}-|\d{2}-)(.+)$/)
  if (m) return { displayName: m[2].trim(), sortName: raw }
  return { displayName: raw, sortName: null }
}

function generateOrganization(docs: Record<string, unknown>[]): string {
  return docs.map(doc => {
    const id    = doc['_id'] as string
    const raw   = doc['name'] as string ?? ''
    const { displayName, sortName } = splitOrgName(raw)
    const name  = escape(displayName)
    const sort  = sortName ? escape(sortName) : null
    const color = doc['color'] as Record<string, unknown> | undefined
    const hex   = color?.['hex'] ? escape(color['hex'] as string) : null

    return `// ── ${id} ──
MERGE (src:Source {sanityId: "${id}", blockKey: "root"})
SET src.extractedAt = datetime()

MERGE (org:Organization {sanityId: "${id}"})
SET org.name = "${name}"${sort ? `\nSET org.sortName = "${sort}"` : ''}${hex ? `\nSET org.color = "${hex}"` : ''}

MERGE (org)-[:EXTRACTED_FROM]->(src)`
  }).join('\n\n')
}

function generateDistrict(docs: Record<string, unknown>[]): string {
  return docs.map(doc => {
    const id    = doc['_id'] as string
    const raw   = doc['name'] as string ?? ''
    const { displayName, sortName } = splitOrgName(raw)
    const name  = escape(displayName)
    const sort  = sortName ? escape(sortName) : null

    return `// ── ${id} ──
MERGE (src:Source {sanityId: "${id}", blockKey: "root"})
SET src.extractedAt = datetime()

MERGE (u:Unit {sanityId: "${id}"})
SET u.name = "${name}"${sort ? `\nSET u.sortName = "${sort}"` : ''}

MERGE (u)-[:EXTRACTED_FROM]->(src)`
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
