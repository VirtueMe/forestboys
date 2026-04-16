/**
 * export-unknown-refs.ts — Export unknown fabricated org/unit refs for manual review
 *
 * For each fabricated sanityId that could not be matched to a known node,
 * outputs a YAML file listing the entity and every document that references it,
 * with the surrounding Cypher block for context.
 *
 * Run:
 *   npx tsx scripts/export-unknown-refs.ts            # all definitive batches
 *   npx tsx scripts/export-unknown-refs.ts msgbatch_  # specific batch
 *
 * Output: data/review/unknown-refs.yaml
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const DATA_DIR = resolve(process.cwd(), 'data')

// ─── Parse known nodes ────────────────────────────────────────────────────────

type KnownNode = { sanityId: string; name: string }

function parseKnownNodes(file: string): KnownNode[] {
  if (!existsSync(file)) return []
  const src = readFileSync(file, 'utf8')
  const nodes: KnownNode[] = []
  for (const block of src.split(/\n(?=\/\/ ──)/)) {
    const idM   = block.match(/\{sanityId: "([^"]+)"\}/)
    const nameM = block.match(/\.name = "([^"]+)"/)
    if (idM && nameM) nodes.push({ sanityId: idM[1], name: nameM[1] })
  }
  return nodes
}

function findMatch(name: string | null, nodes: KnownNode[]): boolean {
  if (!name) return false
  const lower = name.toLowerCase()
  return nodes.some(n =>
    n.name.toLowerCase() === lower ||
    lower.includes(n.name.toLowerCase()) ||
    n.name.toLowerCase().includes(lower)
  )
}

function extractAssignedName(lines: string[], lineIdx: number, varName: string): string | null {
  const pattern = new RegExp(`SET ${varName}\\.name = "([^"]+)"`)
  for (let i = lineIdx; i < Math.min(lineIdx + 10, lines.length); i++) {
    const m = lines[i].match(pattern)
    if (m) return m[1]
  }
  return null
}

const knownOrgs  = parseKnownNodes(resolve(DATA_DIR, 'cypher/organization.cypher'))
const knownUnits = parseKnownNodes(resolve(DATA_DIR, 'cypher/district.cypher'))
const knownOrgIds  = new Set(knownOrgs.map(n => n.sanityId))
const knownUnitIds = new Set(knownUnits.map(n => n.sanityId))

// ─── Find enclosing document block ───────────────────────────────────────────

function findDocumentId(lines: string[], lineIdx: number): string {
  for (let i = lineIdx; i >= 0; i--) {
    const m = lines[i].match(/^\/\/ ── ([^\s]+) ──/)
    if (m) return m[1]
  }
  return 'unknown'
}

function extractCypherBlock(lines: string[], lineIdx: number): string {
  // Walk back to the // ── header, forward to the next // ── header or EOF
  let start = lineIdx
  for (let i = lineIdx; i >= 0; i--) {
    if (lines[i].match(/^\/\/ ── /)) { start = i; break }
  }
  let end = lines.length
  for (let i = lineIdx + 1; i < lines.length; i++) {
    if (lines[i].match(/^\/\/ ── /)) { end = i; break }
  }
  return lines.slice(start, end).join('\n').trim()
}

// ─── Scan ─────────────────────────────────────────────────────────────────────

// ─── Sanity document lookup ───────────────────────────────────────────────────

const sanityCache = new Map<string, Map<string, Record<string, unknown>>>()

function getSanityDoc(type: string, docId: string): Record<string, unknown> | null {
  if (!sanityCache.has(type)) {
    const file = resolve(DATA_DIR, `sanity-${type}.json`)
    if (!existsSync(file)) { sanityCache.set(type, new Map()); return null }
    const docs = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>[]
    const map  = new Map(docs.map(d => [d['_id'] as string, d]))
    sanityCache.set(type, map)
  }
  return sanityCache.get(type)!.get(docId) ?? null
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Occurrence = {
  document:    string
  file:        string
  line:        number
  cypher:      string
  sanityDoc?:  Record<string, unknown> | null
}

type UnknownRef = {
  fabricatedId:  string
  kind:          'Organization' | 'Unit'
  assignedName:  string | null
  occurrences:   Occurrence[]
}

function scanFile(filePath: string, type: string, docType: string): UnknownRef[] {
  if (!existsSync(filePath)) return []
  const lines    = readFileSync(filePath, 'utf8').split('\n')
  const filename = `${type}.cypher`
  const refs     = new Map<string, UnknownRef>()

  lines.forEach((line, i) => {
    const checks: Array<{ pattern: RegExp; kind: 'Organization' | 'Unit'; knownIds: Set<string>; known: KnownNode[] }> = [
      { pattern: /\((\w+):Organization \{sanityId: "([^"]+)"\}\)/g, kind: 'Organization', knownIds: knownOrgIds, known: knownOrgs },
      { pattern: /\((\w+):Unit \{sanityId: "([^"]+)"\}\)/g,         kind: 'Unit',         knownIds: knownUnitIds, known: knownUnits },
    ]

    for (const { pattern, kind, knownIds, known } of checks) {
      for (const m of [...line.matchAll(pattern)]) {
        const [, varName, sanityId] = m
        if (knownIds.has(sanityId)) continue
        const assignedName = extractAssignedName(lines, i, varName)
        if (findMatch(assignedName, known)) continue   // fixable, not unknown

        const key = `${kind}::${sanityId}`
        if (!refs.has(key)) {
          refs.set(key, { fabricatedId: sanityId, kind, assignedName, occurrences: [] })
        }
        const docId = findDocumentId(lines, i)
        refs.get(key)!.occurrences.push({
          document:   docId,
          file:       filename,
          line:       i + 1,
          cypher:     extractCypherBlock(lines, i),
          sanityDoc:  getSanityDoc(docType, docId),
        })
      }
    }
  })

  return [...refs.values()]
}

// ─── YAML serialisation ───────────────────────────────────────────────────────

function yamlStr(s: string): string {
  // Wrap in double quotes, escape inner quotes
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function toYaml(refs: UnknownRef[]): string {
  const lines: string[] = [
    '# Unknown fabricated org/unit sanityId references — manual review required',
    '# Each entry is an entity the model invented that has no match in',
    '# data/cypher/organization.cypher or data/cypher/district.cypher.',
    '#',
    '# For each entry, decide:',
    '#   add_to_sanity: true   → create the entity in Sanity, then re-extract',
    '#   maps_to: <sanityId>   → it actually is a known entity, fix the Cypher',
    '#   discard: true         → extraction error, remove the reference',
    '',
  ]

  for (const ref of refs) {
    lines.push(`- fabricatedId: ${yamlStr(ref.fabricatedId)}`)
    lines.push(`  kind: ${ref.kind}`)
    lines.push(`  assignedName: ${ref.assignedName ? yamlStr(ref.assignedName) : 'null'}`)
    lines.push(`  decision: null   # add_to_sanity | maps_to: <sanityId> | discard`)
    lines.push(`  occurrences:`)
    ref.occurrences.forEach((occ, idx) => {
      lines.push(`    - document: ${yamlStr(occ.document)}`)
      lines.push(`      file: ${occ.file}`)
      lines.push(`      line: ${occ.line}`)
      if (idx === 0) {
        // Full detail on first occurrence only
        if (occ.sanityDoc) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { slug: _slug, gallery: _gallery, movie: _movie, ...doc } = occ.sanityDoc
          lines.push(`      source: |`)
          for (const cl of JSON.stringify(doc, null, 2).split('\n')) {
            lines.push(`        ${cl}`)
          }
        }
        lines.push(`      cypher: |`)
        for (const cl of occ.cypher.split('\n')) {
          lines.push(`        ${cl}`)
        }
      }
    })
    lines.push('')
  }

  return lines.join('\n')
}

// ─── Definitive batches ───────────────────────────────────────────────────────

const DEFINITIVE_BATCHES: Record<string, string> = {
  location:  'msgbatch_01FGzBftySdnJcrxCUTq6bBS',
  station:   'msgbatch_015snnhvMUXvKxLbVF1XNN9D',
  transport: 'msgbatch_01BMpNxzP7uEGGypWd8efAYH',
  person:    'msgbatch_01QChRfQRzNeCQqvmALk7qBT',
  event:     'msgbatch_01QPtDMxU1jXXDjiVZwxh8Ho',
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const idArg = process.argv[2]?.startsWith('msgbatch_') ? process.argv[2] : null

  const allRefs = new Map<string, UnknownRef>()

  const scanTargets = idArg
    ? Object.entries(DEFINITIVE_BATCHES).map(([type]) => ({
        type, batchId: idArg,
      }))
    : Object.entries(DEFINITIVE_BATCHES).map(([type, batchId]) => ({ type, batchId }))

  for (const { type, batchId } of scanTargets) {
    const file = resolve(DATA_DIR, 'batch-runs', batchId, `${type}.cypher`)
    for (const ref of scanFile(file, type, type)) {
      const key = `${ref.kind}::${ref.fabricatedId}`
      if (!allRefs.has(key)) {
        allRefs.set(key, ref)
      } else {
        // Merge occurrences from multiple files
        allRefs.get(key)!.occurrences.push(...ref.occurrences)
      }
    }
  }

  const sorted = [...allRefs.values()].sort((a, b) =>
    a.kind.localeCompare(b.kind) || (a.assignedName ?? '').localeCompare(b.assignedName ?? '')
  )

  const outDir  = resolve(DATA_DIR, 'review')
  const outFile = resolve(outDir, 'unknown-refs.yaml')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(outFile, toYaml(sorted))

  console.log(`${sorted.length} unknown refs written to data/review/unknown-refs.yaml`)
  console.log(`Total occurrences: ${sorted.reduce((n, r) => n + r.occurrences.length, 0)}`)
}

main()
