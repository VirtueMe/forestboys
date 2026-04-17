/**
 * Shared Neo4j import logic for the three-phase import scripts.
 */

import { readFileSync, existsSync } from 'fs'
import neo4j, { type Driver } from 'neo4j-driver'
import * as dotenv from 'dotenv'
import { resolve } from 'path'

const CLEAN_DIR = resolve(process.cwd(), 'data', 'cypher-clean')
const ALL_TYPES = ['organization', 'district', 'location', 'station', 'person', 'transport', 'event']

export interface ImportOptions {
  types: string[]
  production: boolean
  dryRun: boolean
  suffix: string // '.nodes', '.rels', or '.comments'
}

/**
 * Split on semicolons outside string literals.
 */
function splitStatements(raw: string): string[] {
  const parts: string[] = []
  let current = ''
  let inString: string | false = false
  let escaped = false

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (escaped) { current += ch; escaped = false; continue }
    if (ch === '\\') { current += ch; escaped = true; continue }
    if ((ch === '"' || ch === "'") && !inString) { inString = ch; current += ch; continue }
    if (ch === inString) { inString = false; current += ch; continue }
    if (ch === ';' && !inString) { parts.push(current); current = ''; continue }
    current += ch
  }
  if (current.trim().length > 0) parts.push(current)
  return parts
}

interface Statement {
  cypher: string
  params: Record<string, unknown>
}

function parseStatements(raw: string): Statement[] {
  return splitStatements(raw)
    .map(block => {
      const lines = block.split('\n')
      const params: Record<string, unknown> = {}

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

export async function runImport(opts: ImportOptions): Promise<boolean> {
  const envFile = opts.production ? '.env.production' : '.env'
  dotenv.config({ path: resolve(process.cwd(), envFile) })

  console.log(`Using ${envFile} → ${process.env.NEO4J_URI}${opts.dryRun ? ' (dry run)' : ''}`)
  console.log(`Phase: ${opts.suffix.replace('.', '')}`)
  console.log(`Types: ${opts.types.join(', ')}\n`)

  let driver: Driver | null = null
  if (!opts.dryRun) {
    driver = neo4j.driver(
      process.env.NEO4J_URI!,
      neo4j.auth.basic(process.env.NEO4J_USERNAME!, process.env.NEO4J_PASSWORD!),
    )
  }

  let totalOk = 0
  let totalFail = 0

  for (const type of opts.types) {
    const filePath = resolve(CLEAN_DIR, `${type}${opts.suffix}.cypher`)
    if (!existsSync(filePath)) { console.log(`${type}: skipped (no file)`); continue }

    const raw = readFileSync(filePath, 'utf-8')
    if (raw.trim().length === 0) { console.log(`${type}: skipped (empty)`); continue }

    const statements = parseStatements(raw)
    console.log(`${type}: ${statements.length} statements`)

    if (opts.dryRun) continue

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

        // Save failure as a comment on the first entity in the statement
        if (driver) {
          const sidMatch = cypher.match(/sanityId:\s*"([0-9a-f]{8}-[^"]+)"/)
          const labelMatch = cypher.match(/MERGE \(\w+:(\w+)/)
          if (sidMatch && labelMatch) {
            const failSession = driver.session()
            try {
              await failSession.run(
                `MATCH (ent:${labelMatch[1]} {sanityId: $sid})
                 MERGE (cmt:Comment {sanityId: $cmtId})
                 SET cmt.text = $text, cmt.source = "import-failure", cmt.createdAt = datetime()
                 MERGE (ent)-[:HAS_COMMENT]->(cmt)`,
                {
                  sid: sidMatch[1],
                  cmtId: `${sidMatch[1]}_import_fail_${fail}`,
                  text: `IMPORT FAILURE: ${(err as Error).message}\n\nOriginal cypher:\n${cypher}`,
                },
              )
            } catch { /* entity might not exist */ }
            finally { await failSession.close() }
          }
        }
      }
    }

    await session.close()
    console.log(`  ${ok} ok, ${fail} failed`)
    totalOk += ok
    totalFail += fail
  }

  if (driver) await driver.close()

  console.log(`\nTotal: ${totalOk} ok, ${totalFail} failed`)
  if (totalFail > 0) {
    console.error(`\n${totalFail} failures — aborting pipeline.`)
    return false
  }
  return true
}

export function resolveTypes(typeArg: string): string[] {
  if (typeArg === 'all') return ALL_TYPES
  const types = typeArg.split(',').map(t => t.trim())
  const unknown = types.filter(t => !ALL_TYPES.includes(t))
  if (unknown.length) {
    console.error(`Unknown type(s): ${unknown.join(', ')}`)
    process.exit(1)
  }
  return types
}
