/**
 * The functions talk to Neo4j through one helper, `functions/_lib/neo4j.ts`, over the Query API (#176). Aura refuses the
 * older transactional endpoint (`/db/neo4j/tx/commit`: «Denied by administrative rules»), and a private copy of the
 * helper in a function works against the local Docker Neo4j and fails on the production site, where every lookup then
 * looks like «not found». So no other file under `functions/` may name that endpoint.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const FUNCTIONS = join(import.meta.dirname, '..', 'functions')

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return sources(p)
    return e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') ? [p] : []
  })
}

describe('functions convention', () => {
  it('no function posts to the legacy /tx/commit endpoint of Neo4j', () => {
    const offenders = sources(FUNCTIONS)
      .filter(p => !p.endsWith(join('_lib', 'neo4j.ts')))
      .filter(p => /\/tx\/commit/.test(readFileSync(p, 'utf8')))
      .map(p => relative(FUNCTIONS, p))
    expect(offenders).toEqual([])
  })

  it('there is something to scan', () => {
    expect(sources(FUNCTIONS).length).toBeGreaterThan(20)
  })
})
