/**
 * The scripts convention (#78), checked over the source: a script is a dry run
 * unless it is given --write, and every script that opens a graph connection
 * starts from loadEnv(), which is where the localhost guard, the production
 * banner and the refusal of the old switches live.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OLD_WRITE_FLAGS } from './lib/env.ts'

const ROOT = import.meta.dirname

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return sources(p)
    return e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') ? [p] : []
  })
}

const files = sources(ROOT).map(p => ({ name: relative(ROOT, p), text: readFileSync(p, 'utf8') }))

// lib/ holds helpers that entry scripts call after loadEnv; bot/ has its own runtime.
const ENTRY_EXEMPT = /^(lib|bot)\//

describe('scripts convention', () => {
  it('no script reads an old write/dry switch from argv', () => {
    const quoted = new RegExp(`['"](${OLD_WRITE_FLAGS.join('|')})['"]`)
    const offenders = files.filter(f => f.name !== 'lib/env.ts' && quoted.test(f.text)).map(f => f.name)
    expect(offenders).toEqual([])
  })

  it('every script that opens a graph connection goes through loadEnv', () => {
    const connects = /neo4j\.driver\(|neo4jDriver\(|dotenv/
    const offenders = files
      .filter(f => !ENTRY_EXEMPT.test(f.name) && connects.test(f.text) && !f.text.includes('loadEnv'))
      .map(f => f.name)
    expect(offenders).toEqual([])
  })
})
