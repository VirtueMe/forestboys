/**
 * Clean batch-extracted .cypher files and split into three phases:
 *
 *   <type>.nodes.cypher    — MERGE + SET for entity nodes (phase 1)
 *   <type>.rels.cypher     — relationship MERGEs (phase 2)
 *   <type>.comments.cypher — Comment nodes with @param text (phase 3)
 *
 * Everything is data — all inline comments and review notes from the LLM
 * extraction are preserved as (:Comment) nodes linked via [:HAS_COMMENT].
 *
 * Usage:
 *   npx tsx scripts/clean-cypher.ts
 *   npx tsx scripts/clean-cypher.ts -t location,person
 *   npx tsx scripts/clean-cypher.ts -d
 *
 * Reads from data/cypher/<type>.cypher
 * Writes to data/cypher-clean/<type>.{nodes,rels,comments}.cypher
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

const CYPHER_DIR  = resolve(process.cwd(), 'data', 'cypher')
const CLEAN_DIR   = resolve(process.cwd(), 'data', 'cypher-clean')
const BATCH_TYPES = ['location', 'station', 'person', 'transport', 'event']

const argv = await yargs(hideBin(process.argv))
  .usage('$0 [options]')
  .option('type', {
    alias: 't',
    type: 'string',
    default: 'all',
    describe: `Types to clean (${BATCH_TYPES.join(', ')}) or "all"`,
  })
  .option('dry-run', {
    alias: 'd',
    type: 'boolean',
    default: false,
    describe: 'Show stats without writing files',
  })
  .strict()
  .help()
  .parse()

const requestedTypes = argv.type === 'all'
  ? BATCH_TYPES
  : String(argv.type).split(',').map(t => t.trim())

const dryRun = Boolean(argv.dryRun)

// ── Inline comment detection ─────────────────────────────────────────────────

function findInlineComment(line: string): number {
  let inString = false
  let escaped = false

  for (let i = 0; i < line.length - 1; i++) {
    const ch = line[i]
    if (escaped) { escaped = false; continue }
    if (ch === '\\') { escaped = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '/' && line[i + 1] === '/') {
      if (i > 0 && line[i - 1] === ':') continue // URL
      return i
    }
  }
  return -1
}

// ── Variable simplification ──────────────────────────────────────────────────

/**
 * In a multi-line cypher statement, find all MERGE (var:Label {props}) declarations.
 * After the first declaration of each variable, simplify subsequent occurrences of
 * (var:Label {props}) to just (var) — whether in MERGE or relationship targets.
 */
function simplifyDeclaredVars(cypher: string): string {
  // Track declared vars with their sanityId
  const declaredIds: Record<string, string> = {} // var → sanityId
  const lines = cypher.split('\n')
  const result: string[] = []

  for (let line of lines) {
    // Find all (var:Label {sanityId: "id"}) patterns
    const pattern = /\((\w+)(:\w+\s*\{sanityId:\s*"([^"]+)"[^}]*\})\)/g
    let m: RegExpExecArray | null
    const replacements: Array<[string, string]> = []

    while ((m = pattern.exec(line)) !== null) {
      const varName = m[1]
      const full = m[0]
      const sid = m[3]

      if (varName in declaredIds) {
        if (declaredIds[varName] === sid) {
          // Same var, same id → simplify to just (var)
          replacements.push([full, `(${varName})`])
        } else {
          // Same var, different id → rename to var2, var3, etc.
          let n = 2
          while (`${varName}${n}` in declaredIds) n++
          const newName = `${varName}${n}`
          declaredIds[newName] = sid
          // Replace this occurrence and all subsequent refs in the line
          const newSpec = full.replace(`(${varName}${m[2]})`, `(${newName}${m[2]})`)
          replacements.push([full, newSpec])
          // Also need to rename refs in subsequent lines
          // We'll do a second pass for that
        }
      } else {
        declaredIds[varName] = sid
      }
    }

    for (const [from, to] of replacements) {
      line = line.replace(from, to)
    }
    result.push(line)
  }

  return result.join('\n')
}

// ── Entity detection ─────────────────────────────────────────────────────────

const ENTITY_RE = /MERGE \((\w+):(?!Source)(\w+) \{sanityId: "([^"]+)"/

// ── Relationship detection ───────────────────────────────────────────────────
// A "relationship line group" is a set of lines that contains )-[:REL]->(
// These need to be separated from the node creation.

// const REL_RE = /\)-\[.*\]->\(/ // kept for reference

// ── Block cleaning ───────────────────────────────────────────────────────────

interface SplitResult {
  nodeLines: string[]
  relLines: string[]
  comments: string[]
  params: Array<{ key: string; value: string }>
  entityLabel: string | null
  entityId: string | null
}

function splitBlock(block: string): SplitResult {
  const lines = block.split('\n')
  const codeLines: string[] = []
  const comments: string[] = []

  // Phase 1: strip comments, extract inline comments
  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.startsWith('//')) {
      const text = trimmed.replace(/^\/\/\s*/, '').trim()
      if (text.startsWith('──')) continue
      if (text.length > 0) comments.push(text)
      continue
    }

    if (trimmed.length === 0) { codeLines.push(''); continue }

    const inlineIdx = findInlineComment(trimmed)
    if (inlineIdx >= 0) {
      const code = trimmed.slice(0, inlineIdx).trim()
      const comment = trimmed.slice(inlineIdx + 2).trim()
      if (comment.length > 0) comments.push(comment)
      if (code.length > 0) codeLines.push(code)
      continue
    }

    codeLines.push(trimmed)
  }

  // Phase 2: identify the entity variable and split lines into nodes vs rels.
  //
  // Node lines: Source MERGE, Entity MERGE, all SET <entityVar>.prop lines,
  //             and EXTRACTED_FROM relationship.
  // Rel lines:  everything else (relationship MERGEs and their SET lines).

  // Find the entity variable (first non-Source MERGE)
  let entityVar: string | null = null
  for (const line of codeLines) {
    const m = line.match(/^MERGE \((\w+):(?!Source)\w+/)
    if (m) { entityVar = m[1]; break }
  }

  const nodeLines: string[] = []
  const relLines: string[] = []
  let srcAdded = false
  let entityAdded = false

  let i = 0
  while (i < codeLines.length) {
    const line = codeLines[i]
    const trimmed = line.trim()

    // Empty lines — skip
    if (trimmed === '') { i++; continue }

    // Source MERGE + SET src.extractedAt → nodes (only first occurrence)
    if (trimmed.startsWith('MERGE (src:Source')) {
      if (!srcAdded) {
        nodeLines.push(trimmed)
        srcAdded = true
        i++
        while (i < codeLines.length && codeLines[i].trim().startsWith('SET src.')) {
          nodeLines.push(codeLines[i].trim())
          i++
        }
      } else {
        i++ // skip duplicate Source MERGE
      }
      continue
    }

    // Entity MERGE → nodes (only first occurrence)
    if (entityVar && trimmed.startsWith(`MERGE (${entityVar}:`)) {
      if (!entityAdded) {
        nodeLines.push(trimmed)
        entityAdded = true
      }
      // Skip duplicates — don't add to rels either
      i++
      continue
    }

    // SET <entityVar>.prop → nodes
    if (entityVar && (trimmed.startsWith(`SET ${entityVar}.`) || trimmed.startsWith(`${entityVar}.`))) {
      nodeLines.push(trimmed)
      i++
      continue
    }

    // EXTRACTED_FROM → nodes (only first occurrence)
    // Simplify to just variable refs: MERGE (entity)-[:EXTRACTED_FROM]->(src)
    if (trimmed.includes('EXTRACTED_FROM')) {
      if (!nodeLines.some(l => l.includes('EXTRACTED_FROM')) && entityVar) {
        nodeLines.push(`MERGE (${entityVar})-[:EXTRACTED_FROM]->(src)`)
      }
      i++
      continue
    }

    // Skip dangling WITH/MATCH lines (LLM artifacts)
    if (trimmed.startsWith('WITH') || (trimmed.startsWith('MATCH') && !trimmed.includes('MERGE'))) {
      comments.push(`SKIPPED: ${trimmed}`)
      i++
      continue
    }

    // Everything else → rels
    relLines.push(trimmed)
    i++
  }

  // Deduplicate consecutive identical MERGE lines in rels
  const dedupedRels: string[] = []
  for (const rl of relLines) {
    if (dedupedRels.length > 0 && dedupedRels[dedupedRels.length - 1] === rl) continue
    dedupedRels.push(rl)
  }
  relLines.length = 0
  relLines.push(...dedupedRels)

  // Fix LLM syntax errors in rel lines:
  // 1. Double closing parens: MERGE (var)) → MERGE (var))
  // 2. Null property values in MERGE relationships: {to: null} → remove property
  for (let j = 0; j < relLines.length; j++) {
    // Fix double parens
    relLines[j] = relLines[j].replace(/\)\)/g, ')')
    // Remove null properties from relationship MERGE: {prop: null} or , prop: null
    relLines[j] = relLines[j].replace(/,\s*\w+:\s*null/g, '')
    relLines[j] = relLines[j].replace(/\{\s*\w+:\s*null\s*,\s*/g, '{')
    relLines[j] = relLines[j].replace(/\{\s*\w+:\s*null\s*\}/g, '')
    // Clean up empty relationship properties: -[:REL {}]-> → -[:REL]->
    relLines[j] = relLines[j].replace(/\s*\{\s*\}/g, '')
  }

  // Fix string issues in node lines:
  // Parameterise any SET line with problematic string values (German quotes,
  // single-quoted strings with apostrophes, unclosed strings).
  // These get a @param annotation that the import script passes as a parameter.
  let paramCounter = 0
  const blockParams: Array<{ key: string; value: string }> = []

  for (let j = 0; j < nodeLines.length; j++) {
    const line = nodeLines[j]

    // Detect problematic string values
    const hasSingleQuotedStr = /= '/.test(line) && !line.includes('\\"')
    const hasGermanQuote = line.includes('\u201E')
    const hasUnclosedStr = (() => {
      let inS: string | false = false
      let esc = false
      for (const ch of line) {
        if (esc) { esc = false; continue }
        if (ch === '\\') { esc = true; continue }
        if ((ch === '"' || ch === "'") && !inS) { inS = ch; continue }
        if (ch === inS) { inS = false; continue }
      }
      return inS !== false
    })()

    if (!(hasSingleQuotedStr || hasGermanQuote || hasUnclosedStr)) continue

    // Extract property = value pairs and parameterise the values
    // Match: SET var.prop = "value" or var.prop = 'value'
    const propMatch = line.match(/^((?:SET )?\w+\.\w+) = (["'])(.*)/s)
    if (!propMatch) continue

    const prefix = propMatch[1]
    const quoteChar = propMatch[2]

    // Find the full value including potential continuation on next lines
    let fullValue = propMatch[3]
    // Check if the value closes on this line
    let closed = false
    let esc = false
    for (let k = 0; k < fullValue.length; k++) {
      if (esc) { esc = false; continue }
      if (fullValue[k] === '\\') { esc = true; continue }
      if (fullValue[k] === quoteChar && k > 0) {
        // Check if followed by , or end of string
        const rest = fullValue.slice(k + 1).trim()
        if (rest === '' || rest === ',') {
          fullValue = fullValue.slice(0, k)
          closed = true
          break
        }
      }
    }

    if (!closed) {
      // Value spans multiple lines or is unclosed — just parameterise this line's content
      // Strip trailing comma
      fullValue = fullValue.replace(/,?\s*$/, '')
      // Close it
      if (fullValue.endsWith(quoteChar)) {
        fullValue = fullValue.slice(0, -1)
      }
    }

    // Unescape for the parameter value
    const paramValue = fullValue
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/''/g, "'")
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')

    const paramKey = `p${++paramCounter}`
    blockParams.push({ key: paramKey, value: paramValue })

    // Check if there's a trailing comma (continuation)
    const origLine = nodeLines[j]
    const trailingComma = origLine.trimEnd().endsWith(',') ? ',' : ''
    nodeLines[j] = `${prefix} = $${paramKey}${trailingComma}`
  }

  // Entity info from node lines
  const fullCypher = nodeLines.join('\n')
  const entityMatch = fullCypher.match(ENTITY_RE)

  return {
    nodeLines,
    relLines,
    comments,
    params: blockParams,
    entityLabel: entityMatch ? entityMatch[2] : null,
    entityId: entityMatch ? entityMatch[3] : null,
  }
}

// ── File processing ──────────────────────────────────────────────────────────

interface Stats {
  blocks: number
  nodes: number
  rels: number
  withComments: number
  totalComments: number
}

function processFile(type: string): Stats {
  const raw = readFileSync(resolve(CYPHER_DIR, `${type}.cypher`), 'utf-8')
  const blocks = raw.split(/\n(?=\/\/ ── )/)

  const nodeStmts: string[] = []
  const relStmts: string[] = []
  const commentStmts: string[] = []
  let withComments = 0
  let totalComments = 0

  for (const block of blocks) {
    const { nodeLines, relLines, comments, params, entityLabel, entityId } = splitBlock(block)

    if (nodeLines.filter(l => l.trim()).length > 0) {
      const paramLines = params.map(p =>
        `// @param ${p.key} ${Buffer.from(p.value).toString('base64')}`)
      nodeStmts.push([...paramLines, ...nodeLines].join('\n').trim() + ';')
    }

    if (relLines.filter(l => l.trim()).length > 0 && entityId && entityLabel) {
      // Each relationship statement needs the entity variable in scope.
      // Prepend a MERGE for the entity node so the variable is available.
      // Find the entity variable name used in the original block.
      const entVar = (() => {
        for (const nl of nodeLines) {
          const m = nl.match(/^MERGE \((\w+):(?!Source)/)
          if (m) return m[1]
        }
        return 'ent'
      })()
      const entityMerge = `MERGE (${entVar}:${entityLabel} {sanityId: "${entityId}"})`

      // Split into individual relationship groups.
      // Each group starts with MERGE and defines one relationship.
      let currentRel: string[] = []
      for (const rl of relLines) {
        if (rl.startsWith('MERGE') && currentRel.length > 0 &&
            currentRel.some(l => l.includes(']->'))) {
          // Prepend entity MERGE if the group references the entity variable
          const block = currentRel.join('\n')
          let fixed = block
          // Deduplicate MERGE node declarations within the statement.
          // If a variable is declared via MERGE (x:Label {...}) more than once,
          // keep only the first occurrence and simplify later ones to (x).
          const declaredVars = new Set<string>()
          const fixedLines = fixed.split('\n').map(line => {
            const m = line.match(/^MERGE \((\w+)(:\w+\s*\{[^}]*\})/)
            if (m) {
              const varName = m[1]
              if (declaredVars.has(varName)) {
                // Replace the full node spec with just the variable
                return line.replace(`(${varName}${m[2]})`, `(${varName})`)
              }
              declaredVars.add(varName)
            }
            return line
          })
          fixed = fixedLines.join('\n')
          // Also simplify entity and src refs in relationship targets
          // (already handled by the dedup above, but catch any remaining)
          fixed = fixed.replace(/\(src:Source\s*\{[^}]*\}\)/g, '(src)')

          const needsEntity = new RegExp(`\\b${entVar}\\b`).test(fixed) &&
                              !fixed.includes(`MERGE (${entVar}:`)
          const needsSrc = /\bsrc\b/.test(fixed) && !fixed.includes('MERGE (src:')
          let prefix = ''
          if (needsEntity) prefix += entityMerge + '\n'
          if (needsSrc) prefix += `MERGE (src:Source {sanityId: "${entityId}", blockKey: "root"})\n`
          let full = prefix + fixed
          // Final pass: simplify any (var:Label {props}) to (var) when var already declared
          full = simplifyDeclaredVars(full)
          relStmts.push(full + ';')
          currentRel = []
        }
        currentRel.push(rl)
      }
      if (currentRel.length > 0) {
        let fixed = currentRel.join('\n')
        const declaredVars2 = new Set<string>()
        const fixedLines2 = fixed.split('\n').map(line => {
          const m = line.match(/^MERGE \((\w+)(:\w+\s*\{[^}]*\})/)
          if (m) {
            if (declaredVars2.has(m[1])) {
              return line.replace(`(${m[1]}${m[2]})`, `(${m[1]})`)
            }
            declaredVars2.add(m[1])
          }
          return line
        })
        fixed = fixedLines2.join('\n')
        fixed = fixed.replace(/\(src:Source\s*\{[^}]*\}\)/g, '(src)')

        const needsEntity = new RegExp(`\\b${entVar}\\b`).test(fixed) &&
                            !fixed.includes(`MERGE (${entVar}:`)
        const needsSrc = /\bsrc\b/.test(fixed) && !fixed.includes('MERGE (src:')
        let prefix = ''
        if (needsEntity) prefix += entityMerge + '\n'
        if (needsSrc) prefix += `MERGE (src:Source {sanityId: "${entityId}", blockKey: "root"})\n`
        let full2 = prefix + fixed
        full2 = simplifyDeclaredVars(full2)
        relStmts.push(full2 + ';')
      }
    }

    if (comments.length > 0 && entityId && entityLabel) {
      withComments++
      totalComments += comments.length

      const commentBlock = [
        `// @param text ${Buffer.from(comments.join('\n')).toString('base64')}`,
        `MATCH (ent:${entityLabel} {sanityId: "${entityId}"})`,
        `MERGE (cmt:Comment {sanityId: "${entityId}"})`,
        `SET cmt.text = $text,`,
        `    cmt.source = "batch-extraction",`,
        `    cmt.createdAt = datetime()`,
        `MERGE (ent)-[:HAS_COMMENT]->(cmt);`,
      ].join('\n')
      commentStmts.push(commentBlock)
    }
  }

  if (!dryRun) {
    writeFileSync(resolve(CLEAN_DIR, `${type}.nodes.cypher`), nodeStmts.join('\n\n') + '\n')
    writeFileSync(resolve(CLEAN_DIR, `${type}.rels.cypher`), relStmts.join('\n\n') + '\n')
    writeFileSync(resolve(CLEAN_DIR, `${type}.comments.cypher`), commentStmts.join('\n\n') + '\n')
  }

  return {
    blocks: blocks.length,
    nodes: nodeStmts.length,
    rels: relStmts.length,
    withComments,
    totalComments,
  }
}

// ── Simple types (org, district) — already clean, just need splitting ────────

function processSimple(type: string): Stats {
  const raw = readFileSync(resolve(CYPHER_DIR, `${type}.cypher`), 'utf-8')

  // These are already clean with semicolons — just copy as nodes (no rels, no comments)
  if (!dryRun) {
    writeFileSync(resolve(CLEAN_DIR, `${type}.nodes.cypher`), raw)
    writeFileSync(resolve(CLEAN_DIR, `${type}.rels.cypher`), '')
    writeFileSync(resolve(CLEAN_DIR, `${type}.comments.cypher`), '')
  }

  const stmtCount = raw.split(';').filter(s => s.trim().startsWith('MERGE')).length
  return { blocks: stmtCount, nodes: stmtCount, rels: 0, withComments: 0, totalComments: 0 }
}

// ── Main ─────────────────────────────────────────────────────────────────────

mkdirSync(CLEAN_DIR, { recursive: true })

const totals = { blocks: 0, nodes: 0, rels: 0, withComments: 0, totalComments: 0 }

for (const type of ['organization', 'district']) {
  const stats = processSimple(type)
  totals.blocks += stats.blocks
  totals.nodes += stats.nodes
  console.log(`${type}: ${stats.nodes} nodes (already clean)`)
}

for (const type of requestedTypes) {
  const stats = processFile(type)
  totals.blocks += stats.blocks
  totals.nodes += stats.nodes
  totals.rels += stats.rels
  totals.withComments += stats.withComments
  totals.totalComments += stats.totalComments
  console.log(`${type}: ${stats.nodes} nodes, ${stats.rels} rels, ${stats.withComments} comments (${stats.totalComments} lines)`)
}

console.log(`\nTotal: ${totals.nodes} node stmts, ${totals.rels} rel stmts, ${totals.totalComments} comment lines`)
if (!dryRun) {
  console.log(`Output: data/cypher-clean/*.{nodes,rels,comments}.cypher`)
} else {
  console.log('(dry run — no files written)')
}
