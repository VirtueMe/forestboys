/**
 * validate-refs.ts — Verify Organisation and Unit references in batch Cypher output
 *
 * For each Organization/Unit reference in batch Cypher files:
 *   - sanityId references that resolve → OK
 *   - sanityId references that don't resolve → cross-check name against known nodes
 *     FIXABLE  — name matches a known org/unit → suggest replacement sanityId
 *     UNKNOWN  — no match → genuinely new entity mined from prose, needs review
 *   - name-only references → flag if not in known names (soft, informational)
 *
 * Run:
 *   npx tsx scripts/validate-refs.ts                  # all definitive batches
 *   npx tsx scripts/validate-refs.ts msgbatch_...     # specific batch
 */

import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

const DATA_DIR = resolve(process.cwd(), 'data')

// ─── Parse known nodes ────────────────────────────────────────────────────────

type KnownNode = { sanityId: string; name: string }

function parseKnownNodes(file: string): { ids: Set<string>; names: Map<string, string>; nodes: KnownNode[] } {
  const ids   = new Set<string>()
  const names = new Map<string, string>()   // name (lowercase) → sanityId
  const nodes: KnownNode[] = []
  if (!existsSync(file)) return { ids, names, nodes }

  const src     = readFileSync(file, 'utf8')
  const blocks  = src.split(/\n(?=\/\/ ──)/)

  for (const block of blocks) {
    const idMatch   = block.match(/\{sanityId: "([^"]+)"\}/)
    const nameMatch = block.match(/\.name = "([^"]+)"/)
    if (!idMatch || !nameMatch) continue
    const sanityId = idMatch[1]
    const name     = nameMatch[1]
    ids.add(sanityId)
    names.set(name.toLowerCase(), sanityId)
    nodes.push({ sanityId, name })
  }
  return { ids, names, nodes }
}

const knownOrgs  = parseKnownNodes(resolve(DATA_DIR, 'cypher/organization.cypher'))
const knownUnits = parseKnownNodes(resolve(DATA_DIR, 'cypher/district.cypher'))

// ─── Name matching ────────────────────────────────────────────────────────────

function findMatch(fabricatedName: string | null, known: typeof knownOrgs): KnownNode | null {
  if (!fabricatedName) return null
  const lower = fabricatedName.toLowerCase()

  // Exact match
  const exactId = known.names.get(lower)
  if (exactId) return known.nodes.find(n => n.sanityId === exactId) ?? null

  // Substring match — fabricated name contains known name or vice versa
  for (const node of known.nodes) {
    const kl = node.name.toLowerCase()
    if (lower.includes(kl) || kl.includes(lower)) return node
  }
  return null
}

// ─── Extract name assigned to a node from surrounding lines ──────────────────

function extractAssignedName(lines: string[], lineIdx: number, varName: string): string | null {
  // Look up to 10 lines ahead for SET varName.name = "..."
  const pattern = new RegExp(`SET ${varName}\\.name = "([^"]+)"`)
  for (let i = lineIdx; i < Math.min(lineIdx + 10, lines.length); i++) {
    const m = lines[i].match(pattern)
    if (m) return m[1]
  }
  return null
}

// ─── Scan a batch Cypher file ─────────────────────────────────────────────────

type RefIssue = {
  file:          string
  line:          number
  kind:          'Organization' | 'Unit'
  refType:       'sanityId' | 'name'
  value:         string
  assignedName:  string | null
  issue:         'MISSING_FIXABLE' | 'MISSING_UNKNOWN' | 'NAME_ONLY'
  suggestion?:   KnownNode
}

function scanFile(filePath: string): RefIssue[] {
  if (!existsSync(filePath)) return []
  const lines    = readFileSync(filePath, 'utf8').split('\n')
  const issues:  RefIssue[] = []
  const filename = filePath.split('/').slice(-2).join('/')

  lines.forEach((line, i) => {
    // ── sanityId references ──────────────────────────────────────────────────
    for (const m of line.matchAll(/\((\w+):Organization \{sanityId: "([^"]+)"\}\)/g)) {
      const [, varName, sanityId] = m
      if (knownOrgs.ids.has(sanityId)) continue
      const assignedName = extractAssignedName(lines, i, varName)
      const suggestion   = findMatch(assignedName, knownOrgs)
      issues.push({
        file: filename, line: i + 1, kind: 'Organization', refType: 'sanityId',
        value: sanityId, assignedName,
        issue: suggestion ? 'MISSING_FIXABLE' : 'MISSING_UNKNOWN', suggestion: suggestion ?? undefined,
      })
    }

    for (const m of line.matchAll(/\((\w+):Unit \{sanityId: "([^"]+)"\}\)/g)) {
      const [, varName, sanityId] = m
      if (knownUnits.ids.has(sanityId)) continue
      const assignedName = extractAssignedName(lines, i, varName)
      const suggestion   = findMatch(assignedName, knownUnits)
      issues.push({
        file: filename, line: i + 1, kind: 'Unit', refType: 'sanityId',
        value: sanityId, assignedName,
        issue: suggestion ? 'MISSING_FIXABLE' : 'MISSING_UNKNOWN', suggestion: suggestion ?? undefined,
      })
    }

    // ── name-only references (soft) ──────────────────────────────────────────
    for (const m of line.matchAll(/\((?:\w+):Organization \{name: "([^"]+)"\}\)/g)) {
      if (!knownOrgs.names.has(m[1].toLowerCase()))
        issues.push({ file: filename, line: i + 1, kind: 'Organization', refType: 'name', value: m[1], assignedName: null, issue: 'NAME_ONLY' })
    }
    for (const m of line.matchAll(/\((?:\w+):Unit \{name: "([^"]+)"\}\)/g)) {
      if (!knownUnits.names.has(m[1].toLowerCase()))
        issues.push({ file: filename, line: i + 1, kind: 'Unit', refType: 'name', value: m[1], assignedName: null, issue: 'NAME_ONLY' })
    }
  })

  return issues
}

// ─── Definitive batch files ───────────────────────────────────────────────────

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

  console.log(`Known organizations: ${knownOrgs.ids.size} nodes`)
  console.log(`Known units:         ${knownUnits.ids.size} nodes\n`)

  const filesToScan: string[] = []
  if (idArg) {
    for (const type of ['location', 'station', 'transport', 'person', 'event'])
      filesToScan.push(resolve(DATA_DIR, 'batch-runs', idArg, `${type}.cypher`))
  } else {
    for (const [type, batchId] of Object.entries(DEFINITIVE_BATCHES))
      filesToScan.push(resolve(DATA_DIR, 'batch-runs', batchId, `${type}.cypher`))
  }

  const allIssues: RefIssue[] = []
  for (const file of filesToScan) allIssues.push(...scanFile(file))

  const fixable = allIssues.filter(i => i.issue === 'MISSING_FIXABLE')
  const unknown = allIssues.filter(i => i.issue === 'MISSING_UNKNOWN')
  const nameOnly = allIssues.filter(i => i.issue === 'NAME_ONLY')

  // ── FIXABLE ────────────────────────────────────────────────────────────────
  if (fixable.length > 0) {
    console.log(`FIXABLE — fabricated sanityId but name matches a known node (${fixable.length}):\n`)
    for (const { file, line, kind, value, assignedName, suggestion } of fixable) {
      console.log(`  ${file}:${line}`)
      console.log(`    ${kind} fabricated="${value}"  name="${assignedName}"`)
      console.log(`    → replace with sanityId="${suggestion!.sanityId}" (${suggestion!.name})\n`)
    }
  } else {
    console.log('✓ No fixable fabricated sanityId references.\n')
  }

  // ── UNKNOWN ────────────────────────────────────────────────────────────────
  // Deduplicate by fabricated sanityId
  const unknownMap = new Map<string, RefIssue>()
  for (const issue of unknown) unknownMap.set(`${issue.kind}::${issue.value}`, issue)

  if (unknownMap.size > 0) {
    console.log(`UNKNOWN — fabricated sanityId, no name match (${unknownMap.size} unique):\n`)
    for (const { file, line, kind, value, assignedName } of unknownMap.values()) {
      const name = assignedName ? `  name="${assignedName}"` : ''
      console.log(`  ${kind.padEnd(14)} "${value}"${name}  (first seen ${file}:${line})`)
    }
    console.log()
  } else {
    console.log('✓ No unknown fabricated sanityId references.\n')
  }

  // ── NAME-ONLY ──────────────────────────────────────────────────────────────
  const nameOnlyMap = new Map<string, { kind: string; count: number }>()
  for (const { kind, value } of nameOnly) {
    const key = `${kind}::${value}`
    const e = nameOnlyMap.get(key)
    if (e) e.count++
    else nameOnlyMap.set(key, { kind, count: 1 })
  }

  if (nameOnlyMap.size > 0) {
    console.log(`NAME-ONLY — not in known nodes, will create new nodes (${nameOnlyMap.size} unique):\n`)
    for (const [key, { kind, count }] of [...nameOnlyMap.entries()].sort()) {
      console.log(`  ${kind.padEnd(14)} "${key.slice(key.indexOf('::') + 2)}"  (${count}×)`)
    }
    console.log()
  }

  console.log(`Summary: ${fixable.length} fixable  |  ${unknownMap.size} unknown  |  ${nameOnlyMap.size} name-only`)
  if (unknown.length > 0 || fixable.length > 0) process.exit(1)
}

main()
