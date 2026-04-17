/**
 * Import .cypher files into Neo4j via the bolt protocol.
 * Reads connection details from .env (or .env.production with --production).
 *
 * Usage:
 *   npx tsx scripts/neo4j-import-cypher.ts
 *   npx tsx scripts/neo4j-import-cypher.ts --type organization,district
 *   npx tsx scripts/neo4j-import-cypher.ts --type organization -p
 *   npx tsx scripts/neo4j-import-cypher.ts --dry-run
 *
 * Each file is split on semicolons into individual statements.
 * Comments and blank lines are stripped. Safe to re-run (MERGE-based).
 */

import { readFileSync, existsSync } from 'fs'
import neo4j from 'neo4j-driver'
import * as dotenv from 'dotenv'
import { resolve } from 'path'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

const CYPHER_DIR    = resolve(process.cwd(), 'data', 'cypher-clean')
const KNOWN_TYPES   = ['organization', 'district', 'location', 'station', 'person', 'transport', 'event']

const argv = await yargs(hideBin(process.argv))
  .usage('$0 [options]')
  .option('type', {
    alias: 't',
    type: 'string',
    default: 'all',
    describe: `Comma-separated types to import (${KNOWN_TYPES.join(', ')}) or "all"`,
  })
  .option('production', {
    alias: 'p',
    type: 'boolean',
    default: false,
    describe: 'Use .env.production instead of .env',
  })
  .option('dry-run', {
    alias: 'd',
    type: 'boolean',
    default: false,
    describe: 'Parse and count statements without executing',
  })
  .strict()
  .help()
  .parse()

// Resolve types
const requestedTypes = argv.type === 'all'
  ? KNOWN_TYPES
  : String(argv.type).split(',').map(t => t.trim())

const unknown = requestedTypes.filter(t => !KNOWN_TYPES.includes(t))
if (unknown.length) {
  console.error(`Unknown type(s): ${unknown.join(', ')}`)
  console.error(`Valid types: ${KNOWN_TYPES.join(', ')}`)
  process.exit(1)
}

// Resolve files
const files = requestedTypes
  .map(t => resolve(CYPHER_DIR, `${t}.cypher`))
  .filter(f => {
    if (!existsSync(f)) {
      console.warn(`Skipping (not found): ${f}`)
      return false
    }
    return true
  })

if (!files.length) {
  console.error('No cypher files to import.')
  process.exit(1)
}

const envFile = argv.production ? '.env.production' : '.env'
const dryRun  = Boolean(argv.dryRun)

dotenv.config({ path: resolve(process.cwd(), envFile) })
console.log(`Using ${envFile} → ${process.env.NEO4J_URI}${dryRun ? ' (dry run)' : ''}`)
console.log(`Types: ${requestedTypes.join(', ')}\n`)

const driver = dryRun
  ? null
  : neo4j.driver(
      process.env.NEO4J_URI!,
      neo4j.auth.basic(process.env.NEO4J_USERNAME!, process.env.NEO4J_PASSWORD!),
    )

interface Statement {
  cypher: string
  params: Record<string, unknown>
}

/**
 * Split on semicolons that are outside string literals.
 * Handles escaped quotes inside strings.
 */
function splitStatements(raw: string): string[] {
  const parts: string[] = []
  let current = ''
  let inString = false
  let escaped = false

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]

    if (escaped) {
      current += ch
      escaped = false
      continue
    }

    if (ch === '\\') {
      current += ch
      escaped = true
      continue
    }

    if (ch === '"') {
      inString = !inString
      current += ch
      continue
    }

    if (ch === ';' && !inString) {
      parts.push(current)
      current = ''
      continue
    }

    current += ch
  }

  if (current.trim().length > 0) parts.push(current)
  return parts
}

function parseStatements(raw: string): Statement[] {
  return splitStatements(raw)
    .map(block => {
      const lines = block.split('\n')
      const params: Record<string, unknown> = {}

      // Extract @param lines (base64-encoded values)
      const cypherLines = lines.filter(l => {
        const m = l.trim().match(/^\/\/\s*@param\s+(\w+)\s+(.+)$/)
        if (m) {
          params[m[1]] = Buffer.from(m[2], 'base64').toString('utf-8')
          return false
        }
        return !l.trimStart().startsWith('//')
      })

      const cypher = cypherLines.join('\n').trim()
      return { cypher, params }
    })
    .filter(s => s.cypher.length > 0 && /^(?:MERGE|MATCH|CREATE)\b/.test(s.cypher))
}

async function importFile(filePath: string) {
  const raw = readFileSync(filePath, 'utf-8')
  const statements = parseStatements(raw)
  const label = filePath.replace(CYPHER_DIR + '/', '')

  console.log(`${label}: ${statements.length} statements`)

  if (dryRun) return

  const session = driver!.session()
  let ok = 0
  let fail = 0

  for (const { cypher, params } of statements) {
    try {
      await session.run(cypher, params)
      ok++
    } catch (err) {
      fail++
      const preview = cypher.split('\n')[0]?.slice(0, 80)
      console.error(`  FAIL: ${preview}…`)
      console.error(`        ${(err as Error).message}`)
    }
  }

  await session.close()
  console.log(`  ${ok} ok, ${fail} failed`)
}

async function main() {
  for (const f of files) {
    await importFile(f)
  }
  if (driver) await driver.close()
  console.log('\nDone.')
}

main().catch(err => { console.error(err); process.exit(1) })
