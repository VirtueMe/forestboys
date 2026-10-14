/**
 * One-shot: set the editor's `preformatted` style on every block the renderer used to draw as a table
 * by looking for tabs (#260, the rule is scripts/lib/preformatted-blocks.ts). After it the renderer no
 * longer guesses, and nothing looks different: the blocks that were boxes are still boxes.
 *
 * Run it BEFORE the release that removes the guess, on production first. Run before the release, the
 * renderer still guesses and the style is only a second reason for the same box; run after, every
 * table loses its box until this has run.
 *
 * Dry run unless --write. It lists the descriptions and blocks it would change, per kind of owner.
 * Before writing, the old text of every description it changes is saved to
 * data/preformatted-before-<time>.json, enough to put them back. Idempotent: a second run finds
 * nothing. Writes in small transactions and checks afterwards that no description is left to change.
 *
 * Local graph unless --production (scripts/lib/env.ts).
 *
 * Usage: npx tsx scripts/migrations/preformatted-table-blocks.ts [--write] [--production]
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import neo4j, { type Session } from 'neo4j-driver'
import type { SanityBlock } from '../../src/utils/portableText.ts'
import { loadEnv, WRITE } from '../lib/env.ts'
import { neo4jDriver } from '../lib/person-sync.ts'
import { markPreformatted } from '../lib/preformatted-blocks.ts'
loadEnv()

const OUT = resolve(process.cwd(), 'data')
const BATCH = 100

interface Change { id: string; kind: string; owner: string; before: string; after: string; marked: number }

const QUERY = `MATCH (o)-[:HAS_CONTENT]->(d:Description)
               WHERE d.content IS NOT NULL
               RETURN d.id AS id, labels(o)[0] AS kind, coalesce(o.slug, o.id, '?') AS owner, d.content AS content`

async function plan(session: Session): Promise<{ changes: Change[]; unreadable: string[]; total: number }> {
  const rows = (await session.run(QUERY)).records
  const changes: Change[] = []
  const unreadable: string[] = []
  for (const r of rows) {
    const content = r.get('content') as string
    let blocks: SanityBlock[]
    try { blocks = JSON.parse(content) as SanityBlock[] } catch { unreadable.push(String(r.get('id'))); continue }
    if (!Array.isArray(blocks)) { unreadable.push(String(r.get('id'))); continue }
    const { blocks: after, marked } = markPreformatted(blocks)
    if (marked) changes.push({ id: r.get('id') as string, kind: r.get('kind') as string, owner: r.get('owner') as string, before: content, after: JSON.stringify(after), marked })
  }
  return { changes, unreadable, total: rows.length }
}

async function main() {
  const driver = neo4jDriver()
  const read = driver.session({ defaultAccessMode: neo4j.session.READ })
  try {
    const { changes, unreadable, total } = await plan(read)
    const kinds = new Map<string, { descriptions: number; blocks: number }>()
    for (const c of changes) {
      const k = kinds.get(c.kind) ?? { descriptions: 0, blocks: 0 }
      k.descriptions++; k.blocks += c.marked
      kinds.set(c.kind, k)
    }
    console.log(`Descriptions: ${total}. To change: ${changes.length}, ${changes.reduce((n, c) => n + c.marked, 0)} blocks.`)
    for (const [kind, k] of [...kinds].sort((a, b) => b[1].descriptions - a[1].descriptions)) {
      console.log(`  ${kind.padEnd(14)} ${String(k.descriptions).padStart(5)} descriptions, ${String(k.blocks).padStart(5)} blocks`)
    }
    if (unreadable.length) console.log(`\n${unreadable.length} description(s) are not a block list and are left alone: ${unreadable.slice(0, 5).join(', ')}${unreadable.length > 5 ? ', …' : ''}`)

    if (!WRITE) { console.log('\n(dry run — pass --write to apply)'); return }
    if (!changes.length) { console.log('\nNothing to write.'); return }

    mkdirSync(OUT, { recursive: true })
    const file = resolve(OUT, `preformatted-before-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    writeFileSync(file, JSON.stringify(changes.map(({ id, kind, owner, before }) => ({ id, kind, owner, content: before }))) + '\n')
    console.log(`\nBackup of ${changes.length} descriptions: ${file}`)

    const ws = driver.session({ defaultAccessMode: neo4j.session.WRITE })
    try {
      for (let i = 0; i < changes.length; i += BATCH) {
        const items = changes.slice(i, i + BATCH).map(({ id, before, after }) => ({ id, before, after }))
        // The old text is part of the match: a description edited since the plan was made is not overwritten.
        const n = (await ws.executeWrite(tx => tx.run(
          `UNWIND $items AS it MATCH (d:Description {id: it.id}) WHERE d.content = it.before SET d.content = it.after RETURN count(d) AS n`,
          { items },
        ))).records[0].get('n')
        const written = neo4j.isInt(n) ? n.toNumber() : (n as number)
        if (written !== items.length) throw new Error(`batch at ${i}: ${written} of ${items.length} written, the rest changed since the plan — stopping, run again`)
        console.log(`  written ${Math.min(i + BATCH, changes.length)} / ${changes.length}`)
      }
    } finally { await ws.close() }

    const left = (await plan(read)).changes.length
    console.log(`Left to change: ${left}.`)
    if (left) process.exitCode = 1
  } finally {
    await read.close()
    await driver.close()
  }
}
main().catch(e => { console.error(e); process.exit(1) })
