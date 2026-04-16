/**
 * fix-cypher.ts — Post-process Cypher batch output to fix known extraction issues
 *
 * Run:
 *   npx tsx scripts/fix-cypher.ts <batchId>          # fix specific batch
 *   npx tsx scripts/fix-cypher.ts                     # fix latest batch (data/batch-id.txt)
 *
 * Fixes are applied in-place. A .bak copy is written before any changes.
 *
 * ── Known fixes ───────────────────────────────────────────────────────────────
 *
 * Fix 1: Milorg org/unit conflation  (person.cypher)
 *   Model sometimes merges org + unit into one Unit node:
 *     MERGE (u:Unit {name: "Milorg D 14.2"})
 *   Correct split:
 *     MERGE (org:Organization {name: "Milorg"})
 *     MERGE (u:Unit {name: "D 14.2"})
 *     MERGE (u)-[:PART_OF]->(org)
 *   Same pattern applies to any "Milorg <suffix>" unit name.
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs'
import { resolve } from 'path'

const DATA_DIR      = resolve(process.cwd(), 'data')
const BATCH_ID_FILE = resolve(DATA_DIR, 'batch-id.txt')

// ─── Shared: parse known nodes from simple-cypher files ──────────────────────

type KnownNode = { sanityId: string; name: string }

function parseKnownNodes(file: string): KnownNode[] {
  if (!existsSync(file)) return []
  const src    = readFileSync(file, 'utf8')
  const blocks = src.split(/\n(?=\/\/ ──)/)
  const nodes: KnownNode[] = []
  for (const block of blocks) {
    const idM   = block.match(/\{sanityId: "([^"]+)"\}/)
    const nameM = block.match(/\.name = "([^"]+)"/)
    if (idM && nameM) nodes.push({ sanityId: idM[1], name: nameM[1] })
  }
  return nodes
}

function findMatch(name: string | null, nodes: KnownNode[]): KnownNode | null {
  if (!name) return null
  const lower = name.toLowerCase()
  return (
    nodes.find(n => n.name.toLowerCase() === lower) ??
    nodes.find(n => lower.includes(n.name.toLowerCase()) || n.name.toLowerCase().includes(lower)) ??
    null
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

// ─── Alias maps: fabricated ID pattern / name variant → real sanityId ─────────
//
// Key: regex that matches the fabricated sanityId OR the assigned name
// Value: real sanityId from organization.cypher or district.cypher

const ORG_ALIASES: Array<{ match: RegExp; sanityId: string; canonical: string }> = [
  // Kompani Linge — many spellings and fabricated IDs (incl. "Linge NORICL", "NORIC(1)")
  { match: /kp.?linge|kompani.?linge|linge.?comp|linge.?noric|noric[l1]\b|nor\.?i\.?c\.?1|noric1|lingekompani/i,
    sanityId: 'bc2e9f77-64f5-470e-b743-2b6fbe0663f7', canonical: 'Kompani Linge' },
  // SOE
  { match: /\bsoe\b/i,
    sanityId: 'c5493f22-9640-4907-8638-19d14f156876', canonical: 'SOE' },
  // Milorg
  { match: /\bmilorg\b/i,
    sanityId: '7ae37887-fd90-4acd-b2e2-7fdf9df32eb8', canonical: 'Milorg' },
  // NNIU — canonical must match name in organization.cypher exactly
  { match: /nniu|norwegian.?naval.?independent/i,
    sanityId: '7c06de26-f19e-440d-927e-d10fa4aea711', canonical: 'NNIU - Norwegian Naval Independent Unit' },
  // FO IV / FO-IV / FO4
  { match: /\bfo.?iv\b|\bfo.?4\b|forsvarets.?overkommando/i,
    sanityId: 'e6e32b06-6866-4cc2-a50c-c65f4f4beaf0', canonical: 'FO IV - MI 4' },
  // RAF / RCAF / RAAF / RNZAF — all squadron variants map to the combined RAF org
  { match: /\braf\b|\brcaf\b|\braaf\b|\brnzaf\b|royal.?air.?force/i,
    sanityId: '2938d151-f7bd-4cfe-9e71-305b2955290a', canonical: 'RAF/RCAF/RAAF/RNZAF' },
  // Norwegian RAF squadrons referenced as standalone orgs (330, 331, 332, 333, 1477 Flight, etc.)
  { match: /\b3[23]\d[\s()0-9]*(skvadron|squadron|sg\b|flight)|1477.?flight|419.*(?:flight|duties)|138.?squadron/i,
    sanityId: '2938d151-f7bd-4cfe-9e71-305b2955290a', canonical: 'RAF/RCAF/RAAF/RNZAF' },
  // SIS
  { match: /\bsis\b|secret.?intelligence.?service/i,
    sanityId: 'a3a97181-028b-4bf8-b787-3125e22fd2e5', canonical: 'SIS' },
]

// Unit aliases — for Unit nodes whose fabricated sanityId should map to a real district sanityId.
// Listed most-specific first (sub-districts before parent districts).
const UNIT_ALIASES: Array<{ match: RegExp; sanityId: string; canonical: string }> = [
  // Milorg D14.1 variants (with or without "Milorg" prefix; also "Distrikt 141")
  { match: /(?:milorg[\s.]*)?\bd[\s.-]*14[\s.-]*1\b|distrikt\s*141\b/i,
    sanityId: '1b6ee3f9-1a04-4b80-8034-243a18d14aee', canonical: 'Milorg D14.1' },
  // Milorg D14.2 — space variant "D 14.2", sub-groups "Gruppe 14.2.x", "Dl4.2" typo, "Distrikt 142"
  { match: /(?:milorg[\s.]*)?\bd[l1][\s.-]*4[\s.-]*2|milorg[\s.]*d[\s.-]*14[\s.-]*2|gruppe[\s.-]*14[\s.-]*2|distrikt\s*142\b/i,
    sanityId: '83d8894c-c81d-413a-aa0c-c837190f5a65', canonical: 'Milorg D14.2' },
  // Milorg D14.3 variants (D14.32, D14.33, D14.3.2, HS 1431 J, H.S. Gruppe 14.3.x, "Distrikt 143")
  { match: /(?:milorg[\s.]*)?\bd[\s.-]*14[\s.-]*3|hs[\s.-]*1431|h\.?\s*s\.?\s*gruppe\s*14\.?3|distrikt\s*143\b/i,
    sanityId: '5d0d6f96-9d62-4365-b531-3e455b61c34a', canonical: 'Milorg D14.3' },
  // Milorg D16.1/2/3 variants
  { match: /(?:milorg[\s.]*)?\bd[\s.-]*16[\s.-]*1\b/i, sanityId: '1ff845a5-d493-43ad-b533-1b6ad94e38f1', canonical: 'Milorg D16.1' },
  { match: /(?:milorg[\s.]*)?\bd[\s.-]*16[\s.-]*2\b/i, sanityId: 'fbc51548-0040-4173-b07c-b6d405c07533', canonical: 'Milorg D16.2' },
  { match: /(?:milorg[\s.]*)?\bd[\s.-]*16[\s.-]*3\b/i, sanityId: '2099a2ee-2bc1-4709-a987-907705ca36b7', canonical: 'Milorg D16.3' },
  // Milorg D20.1/2/3 variants
  { match: /(?:milorg[\s.]*)?\bd[\s.-]*20[\s.-]*1\b/i, sanityId: '3ce86672-31f7-404c-b9b5-2e5f9eb8d1ea', canonical: 'Milorg D20.1' },
  { match: /(?:milorg[\s.]*)?\bd[\s.-]*20[\s.-]*2\b/i, sanityId: 'fde26d1e-94c4-4f7d-9da7-5fde0b60cdf7', canonical: 'Milorg D20.2' },
  { match: /(?:milorg[\s.]*)?\bd[\s.-]*20[\s.-]*3\b/i, sanityId: '1c4ab3ae-7c0b-49bc-90c0-cd0c8a80bdef', canonical: 'Milorg D20.3' },
  // Milorg D11–D26, D40 — single-level districts (listed after sub-districts)
  // Patterns also match bare "D-23 Gudbrandsdal", "D23", "stub-district-d23" etc.
  { match: /(?:milorg[\s.]*)?\bd[\s.-]*11\b/i, sanityId: '507d4fad-ce6c-4a76-821b-70b9c9648080', canonical: 'Milorg D11' },
  { match: /(?:milorg[\s.]*)?\bd[\s.-]*12\b/i, sanityId: 'b9302428-1df7-4b15-a98b-01f9092ae801', canonical: 'Milorg D12' },
  { match: /(?:milorg[\s.]*)?\bd[\s.-]*13\b/i, sanityId: '4179fac4-ac28-4c01-b15e-681f0cd9342d', canonical: 'Milorg D13' },
  { match: /(?:milorg[\s.]*)?\bd[\s.-]*15\b/i, sanityId: '4a7ff9e3-6644-467d-b42b-582f14a209ed', canonical: 'Milorg D15' },
  { match: /(?:milorg[\s.]*)?\bd[\s.-]*17\b/i, sanityId: '3584b212-8881-4825-8780-5d96ca98a132', canonical: 'Milorg D17' },
  // Milorg D18 — also matches "Milorg 18" (missing D prefix)
  { match: /milorg[\s.-]*d?[\s.-]*18\b|(?:milorg[\s.]*)?\bd[\s.-]*18\b/i, sanityId: '83b6e165-6fb4-403d-8784-6a368c5783ea', canonical: 'Milorg D18' },
  { match: /(?:milorg[\s.]*)?\bd[\s.-]*19\b/i, sanityId: '2d67eb6d-507e-4e8f-a514-683fdd814c95', canonical: 'Milorg D19' },
  { match: /(?:milorg[\s.]*)?\bd[\s.-]*21\b/i, sanityId: 'f4d42d14-9eb3-43be-bb31-3fadc0eae0c0', canonical: 'Milorg D21' },
  { match: /(?:milorg[\s.]*)?\bd[\s.-]*22\b/i, sanityId: 'b19de658-ba4c-447d-a5f0-16f250d57454', canonical: 'Milorg D22' },
  { match: /(?:milorg[\s.]*)?\bd[\s.-]*23\b/i, sanityId: '0b187806-4946-4b26-8c80-ff1a40744c83', canonical: 'Milorg D23' },
  { match: /(?:milorg[\s.]*)?\bd[\s.-]*24\b/i, sanityId: '1fc7c0ee-6daf-4f00-802d-7d72e76e7b13', canonical: 'Milorg D24' },
  { match: /(?:milorg[\s.]*)?\bd[\s.-]*25\b/i, sanityId: 'e361cfb2-3c99-4e4c-8e37-7c7a9e1b074d', canonical: 'Milorg D25' },
  { match: /(?:milorg[\s.]*)?\bd[\s.-]*26\b/i, sanityId: 'ba1467c2-30c5-4381-b2a3-07f4bc0cb6f7', canonical: 'Milorg D26' },
  { match: /(?:milorg[\s.]*)?\bd[\s.-]*40\b/i, sanityId: 'a6b7ab88-a562-4079-b24a-e9322e666979', canonical: 'Milorg D40' },
  // ANCC
  { match: /ancc\b|anglo.?norwegian.?collab/i,
    sanityId: 'c3b72372-6b6a-4f1c-8150-2576f92a83c5', canonical: 'ANGLO-NORWEGIAN COLLABORATION COMMITTEE' },
  // R-Gruppen / Rognes Party
  { match: /r-?gruppen|rognes.?party/i,
    sanityId: '181d2e43-9e22-4155-9b38-be387bb392ed', canonical: 'R-Gruppen - SS (Rognes) Party' },
  // Norwegian RAF squadrons (331, 332, 333) + 1477 Flight + 132 Wing → RAF Unit
  // Correct RAF Unit sanityId: 23e9767b-806f-4bd2-b925-209be64fc9d8
  { match: /\b33[123]\s*(skvadron|squadron)|1477.?flight|no\.?\s*6332|raaf\s*464|132\s*\(n\)/i,
    sanityId: '23e9767b-806f-4bd2-b925-209be64fc9d8', canonical: 'RAF' },
  // SOE as Unit (district "02-SOE")
  { match: /\bsoe\b|special.?operations.?executive/i,
    sanityId: '3d01f3fd-cf09-4566-b74e-0388800a73e0', canonical: 'SOE (unit)' },
  // SIS-XU as Unit
  { match: /sis-?xu\b/i,
    sanityId: '1a0aa647-eb0c-4ae8-844d-22b07e1fd627', canonical: 'SIS-XU' },
]

function resolveOrgAlias(fabricatedId: string, assignedName: string | null): string | null {
  const haystack = `${fabricatedId} ${assignedName ?? ''}`.toLowerCase()
  for (const alias of ORG_ALIASES) {
    if (alias.match.test(haystack)) return alias.sanityId
  }
  return null
}

function resolveUnitAlias(fabricatedId: string, assignedName: string | null): string | null {
  const haystack = `${fabricatedId} ${assignedName ?? ''}`.toLowerCase()
  for (const alias of UNIT_ALIASES) {
    if (alias.match.test(haystack)) return alias.sanityId
  }
  return null
}

// ─── Fix definitions ──────────────────────────────────────────────────────────

type Fix = {
  name:    string
  files:   string[]          // which .cypher files to apply to
  apply:   (src: string) => { result: string; count: number }
}

const FIXES: Fix[] = [
  {
    name:  'Milorg org/unit conflation (D-districts)',
    files: ['person.cypher', 'event.cypher'],
    apply(src) {
      let count = 0
      const MILORG_ORG_ID = '7ae37887-fd90-4acd-b2e2-7fdf9df32eb8'
      // Matches D-prefixed district codes: "Milorg D 14.2", "Milorg D18", "Milorg D-13.1.30"
      const MILORG_UNIT = /MERGE \((\w+):Unit \{name: "(Milorg (D[\s\d.-]+))"\}\)/g
      const result = src.replace(
        MILORG_UNIT,
        (_match, varName, _full, unit) => {
          count++
          const unitName = unit.trim()
          // Use sanityId when we can resolve the district code
          const realUnitId = resolveUnitAlias('', unitName)
          if (realUnitId) {
            return [
              `MERGE (org:Organization {sanityId: "${MILORG_ORG_ID}"})`,
              `MERGE (${varName}:Unit {sanityId: "${realUnitId}"})`,
              `MERGE (${varName})-[:PART_OF]->(org)`,
            ].join('\n')
          }
          return [
            `MERGE (org:Organization {sanityId: "${MILORG_ORG_ID}"})`,
            `MERGE (${varName}:Unit {name: "${unitName}"})`,
            `MERGE (${varName})-[:PART_OF]->(org)`,
          ].join('\n')
        },
      )
      return { result, count }
    },
  },
  {
    // Model dropped the comma in "Milorg i Ål, gruppe B - 4 tropp" and ran org+unit together
    // Source text: "Var med i Milorg i Ål, gruppe B - 4 tropp"
    // Correct unit name: "Ål, gruppe B - 4 tropp"
    name:  'Milorg org/unit conflation (Ål gruppe)',
    files: ['person.cypher'],
    apply(src) {
      let count = 0
      const result = src.replace(
        /MERGE \((\w+):Unit \{name: "Milorg Ål gruppe B - 4 tropp"\}\)/g,
        (_match, varName) => {
          count++
          return [
            `MERGE (org:Organization {name: "Milorg"})`,
            `MERGE (${varName}:Unit {name: "Ål, gruppe B - 4 tropp"})`,
            `MERGE (${varName})-[:PART_OF]->(org)`,
          ].join('\n')
        },
      )
      return { result, count }
    },
  },
  {
    // Convert name-only MERGE nodes to sanityId-based where the alias maps resolve them.
    // Also corrects node label when name-only Unit actually refers to an Organization (or v.v.).
    name:  'Name-only Unit/Organization refs → alias-matched sanityId',
    files: ['location.cypher', 'station.cypher', 'transport.cypher', 'person.cypher', 'event.cypher'],
    apply(src) {
      let count = 0
      const lines = src.split('\n')
      const result = lines.map(line => {
        // Name-only Organization refs → sanityId
        for (const m of [...line.matchAll(/\((\w+):Organization \{name: "([^"]+)"\}\)/g)]) {
          const [full, varName, name] = m
          const realOrgId = resolveOrgAlias('', name)
          if (!realOrgId) continue
          line = line.replace(full, `(${varName}:Organization {sanityId: "${realOrgId}"})`)
          count++
        }
        // Name-only Unit refs → sanityId (same label, or type-corrected to Organization)
        for (const m of [...line.matchAll(/\((\w+):Unit \{name: "([^"]+)"\}\)/g)]) {
          const [full, varName, name] = m
          const realUnitId = resolveUnitAlias('', name)
          if (realUnitId) {
            line = line.replace(full, `(${varName}:Unit {sanityId: "${realUnitId}"})`)
            count++
            continue
          }
          // Type mismatch: name-only Unit that is actually an Organization
          const realOrgId = resolveOrgAlias('', name)
          if (!realOrgId) continue
          line = line.replace(full, `(${varName}:Organization {sanityId: "${realOrgId}"})`)
          count++
        }
        return line
      }).join('\n')
      return { result, count }
    },
  },
  {
    // Resolve fabricated Organization sanityIds using alias map —
    // catches null-assignedName cases and name variants the fuzzy matcher missed.
    name:  'Fabricated org sanityId → alias-matched real sanityId',
    files: ['location.cypher', 'station.cypher', 'transport.cypher', 'person.cypher', 'event.cypher'],
    apply(src) {
      let count = 0
      const lines = src.split('\n')
      const result = lines.map((line, i) => {
        for (const m of [...line.matchAll(/\((\w+):Organization \{sanityId: "([^"]+)"\}\)/g)]) {
          const [full, varName, sanityId] = m
          if (knownOrgIds.has(sanityId)) continue
          const assignedName = extractAssignedName(lines, i, varName)
          const realId = resolveOrgAlias(sanityId, assignedName)
          if (!realId) continue
          line = line.replace(full, `(${varName}:Organization {sanityId: "${realId}"})`)
          count++
        }
        return line
      }).join('\n')
      return { result, count }
    },
  },
  {
    // Resolve fabricated Unit sanityIds using the alias map —
    // handles space variants ("D 14.2" vs "D14.2"), sub-district codes, squadron names, etc.
    name:  'Fabricated unit sanityId → alias-matched real sanityId',
    files: ['location.cypher', 'station.cypher', 'transport.cypher', 'person.cypher', 'event.cypher'],
    apply(src) {
      let count = 0
      const lines = src.split('\n')
      const result = lines.map((line, i) => {
        for (const m of [...line.matchAll(/\((\w+):Unit \{sanityId: "([^"]+)"\}\)/g)]) {
          const [full, varName, sanityId] = m
          if (knownUnitIds.has(sanityId)) continue
          const assignedName = extractAssignedName(lines, i, varName)
          const realId = resolveUnitAlias(sanityId, assignedName)
          if (!realId) continue
          line = line.replace(full, `(${varName}:Unit {sanityId: "${realId}"})`)
          count++
        }
        return line
      }).join('\n')
      return { result, count }
    },
  },
  {
    // Type mismatch: model used :Unit for a node that is actually an :Organization.
    // Changes label Unit → Organization, fixes sanityId, and corrects the assigned name
    // to match the canonical org name so it doesn't overwrite the value from organization.cypher.
    name:  'Type mismatch: :Unit node → :Organization (label + sanityId correction)',
    files: ['person.cypher', 'event.cypher'],
    apply(src) {
      let count = 0
      const lines = src.split('\n')
      for (let i = 0; i < lines.length; i++) {
        for (const m of [...lines[i].matchAll(/\((\w+):Unit \{sanityId: "([^"]+)"\}\)/g)]) {
          const [full, varName, sanityId] = m
          if (knownUnitIds.has(sanityId)) continue
          const assignedName = extractAssignedName(lines, i, varName)
          const realOrgId = resolveOrgAlias(sanityId, assignedName)
          if (!realOrgId) continue
          const alias = ORG_ALIASES.find(a => a.sanityId === realOrgId)!
          // Correct node label and sanityId
          lines[i] = lines[i].replace(full, `(${varName}:Organization {sanityId: "${realOrgId}"})`)
          // Correct the assigned name so it matches the org's authoritative name
          const namePattern = new RegExp(`(^\\s*SET ${varName}\\.name = )"[^"]+"`)
          for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
            if (namePattern.test(lines[j])) {
              lines[j] = lines[j].replace(namePattern, `$1"${alias.canonical}"`)
              break
            }
          }
          count++
        }
      }
      return { result: lines.join('\n'), count }
    },
  },
  {
    // Type mismatch: model used :Organization for a node that is actually a :Unit.
    // Changes label Organization → Unit and fixes sanityId.
    name:  'Type mismatch: :Organization node → :Unit (label + sanityId correction)',
    files: ['person.cypher', 'event.cypher'],
    apply(src) {
      let count = 0
      const lines = src.split('\n')
      for (let i = 0; i < lines.length; i++) {
        for (const m of [...lines[i].matchAll(/\((\w+):Organization \{sanityId: "([^"]+)"\}\)/g)]) {
          const [full, varName, sanityId] = m
          if (knownOrgIds.has(sanityId)) continue
          const assignedName = extractAssignedName(lines, i, varName)
          const realUnitId = resolveUnitAlias(sanityId, assignedName)
          if (!realUnitId) continue
          const alias = UNIT_ALIASES.find(a => a.sanityId === realUnitId)!
          // Correct node label and sanityId
          lines[i] = lines[i].replace(full, `(${varName}:Unit {sanityId: "${realUnitId}"})`)
          // Correct the assigned name to the canonical unit name
          const namePattern = new RegExp(`(^\\s*SET ${varName}\\.name = )"[^"]+"`)
          for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
            if (namePattern.test(lines[j])) {
              lines[j] = lines[j].replace(namePattern, `$1"${alias.canonical}"`)
              break
            }
          }
          count++
        }
      }
      return { result: lines.join('\n'), count }
    },
  },
  {
    // Model invented sanityIds for org/unit nodes mined from prose.
    // Cross-reference the assigned name against known org/unit nodes.
    // Replace fabricated sanityId with the real one where a match is found.
    name:  'Fabricated sanityId → real sanityId (name-matched)',
    files: ['location.cypher', 'station.cypher', 'transport.cypher', 'person.cypher', 'event.cypher'],
    apply(src) {
      let count = 0
      const lines  = src.split('\n')
      const result = lines.map((line, i) => {
        // Organization
        for (const m of [...line.matchAll(/\((\w+):Organization \{sanityId: "([^"]+)"\}\)/g)]) {
          const [full, varName, sanityId] = m
          if (knownOrgIds.has(sanityId)) continue
          const name = extractAssignedName(lines, i, varName)
          const match = findMatch(name, knownOrgs)
          if (!match) continue
          line = line.replace(full, `(${varName}:Organization {sanityId: "${match.sanityId}"})`)
          count++
        }
        // Unit
        for (const m of [...line.matchAll(/\((\w+):Unit \{sanityId: "([^"]+)"\}\)/g)]) {
          const [full, varName, sanityId] = m
          if (knownUnitIds.has(sanityId)) continue
          const name = extractAssignedName(lines, i, varName)
          const match = findMatch(name, knownUnits)
          if (!match) continue
          line = line.replace(full, `(${varName}:Unit {sanityId: "${match.sanityId}"})`)
          count++
        }
        return line
      }).join('\n')
      return { result, count }
    },
  },
]

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const idArg = process.argv[2]?.startsWith('msgbatch_') ? process.argv[2] : null

  if (!idArg && !existsSync(BATCH_ID_FILE)) {
    console.error('No batch ID given and data/batch-id.txt not found.')
    console.error('Usage: npx tsx scripts/fix-cypher.ts [msgbatch_...]')
    process.exit(1)
  }

  const batchId  = idArg ?? readFileSync(BATCH_ID_FILE, 'utf8').trim()
  const BATCH_DIR = resolve(DATA_DIR, 'batch-runs', batchId)

  if (!existsSync(BATCH_DIR)) {
    console.error(`Batch directory not found: ${BATCH_DIR}`)
    process.exit(1)
  }

  console.log(`Applying fixes to batch ${batchId}\n`)

  let totalFixed = 0

  for (const fix of FIXES) {
    for (const filename of fix.files) {
      const file = resolve(BATCH_DIR, filename)
      if (!existsSync(file)) continue

      const src = readFileSync(file, 'utf8')
      const { result, count } = fix.apply(src)

      if (count === 0) {
        console.log(`  [${fix.name}] ${filename} — no matches`)
        continue
      }

      // Write backup before modifying
      const bak = `${file}.bak`
      if (!existsSync(bak)) copyFileSync(file, bak)

      writeFileSync(file, result, 'utf8')
      console.log(`  [${fix.name}] ${filename} — fixed ${count} occurrence${count > 1 ? 's' : ''} (backup: ${filename}.bak)`)
      totalFixed += count
    }
  }

  console.log(`\nDone. ${totalFixed} total fix${totalFixed !== 1 ? 'es' : ''} applied.`)
}

main()
