/**
 * One-shot: normalise the Sources stored with whitespace round their address (#113).
 * The rules are in scripts/lib/link-source-normalise.ts: a Source whose trimmed address has no
 * Source yet is renamed in place (`url` and `id`); one that has (a twin) is merged into it — the
 * owners' REFERENCED_IN edges move, the padded Source is deleted.
 *
 * Run it AFTER the first write of the event and person syncs with the trimming link rule, not before:
 * the sync's clean apply moves its owners to the trimmed Sources, and renaming first would turn a node
 * that also has a missing leading-space link into a false conflict (see the library). What is left for
 * this is the padded Sources nothing refers to (deleted) and owners no sync covers, such as
 * transports (renamed, or merged into a twin).
 *
 * Dry run unless --write. Before writing, every affected Source (properties and edges) is saved to
 * data/sanity-delta/link-source-before-<time>.json — enough to put them back. Idempotent: a second
 * run finds nothing padded. Refuses to write when a Source is skipped or the result does not
 * check out (nothing padded left, every owner holds the trimmed Source).
 *
 * Local graph unless --production (scripts/lib/env.ts).
 *
 * Usage: npx tsx scripts/migrations/normalize-padded-link-sources.ts [--write]
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import neo4j from 'neo4j-driver'
import { loadEnv } from '../lib/env.ts'
import { neo4jDriver } from '../lib/person-sync.ts'
import { DELETE_QUERY, MERGE_QUERIES, PADDED_QUERY, RENAME_QUERY, planNormalise, type PaddedSource } from '../lib/link-source-normalise.ts'
loadEnv()

const write = process.argv.includes('--write')
const OUT = resolve(process.cwd(), 'data', 'sanity-delta')
const asInt = (v: unknown): number => (neo4j.isInt(v) ? v.toNumber() : (v as number))

async function main() {
  const driver = neo4jDriver()
  const read = driver.session({ defaultAccessMode: neo4j.session.READ })
  try {
    const padded: PaddedSource[] = (await read.run(PADDED_QUERY)).records.map(r => ({ id: r.get('id') as string, url: r.get('url') as string, owners: asInt(r.get('owners')) }))
    const existing = (await read.run(`MATCH (x:Source) RETURN x.id AS id`)).records.map(r => r.get('id') as string)
    const plan = planNormalise(padded, existing)

    console.log(`Sources stored with whitespace round the address: ${padded.length}`)
    for (const a of plan) {
      const p = padded.find(x => x.id === a.id)!
      const what = a.kind === 'rename' ? `rename → ${a.to}` : a.kind === 'merge' ? `merge into ${a.into}` : a.kind === 'delete' ? 'delete (nothing refers to it)' : `skip (${a.reason})`
      console.log(`  ${a.kind.padEnd(6)} ${JSON.stringify(p.url)} — ${p.owners} edge(s)\n         ${what}`)
    }
    const skipped = plan.filter(a => a.kind === 'skip')
    if (skipped.length) console.log(`\n${skipped.length} skipped — refusing to write until they are looked at.`)

    if (!write) { console.log('\n(dry run — pass --write to apply)'); return }
    if (!plan.length) { console.log('\nNothing to write.'); return }
    if (skipped.length) { process.exitCode = 1; return }

    // ── Backup ──
    const snap = (await read.run(`
      UNWIND $ids AS id MATCH (x:Source {id: id})
      RETURN properties(x) AS props,
             [(a)-[r:REFERENCED_IN]->(x) | {label: head(labels(a)), owner: coalesce(a.slug, a.id), props: properties(r)}] AS owners`,
      { ids: padded.map(p => p.id) })).records.map(r => r.toObject())
    mkdirSync(OUT, { recursive: true })
    const file = resolve(OUT, `link-source-before-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    writeFileSync(file, JSON.stringify({ plan, sources: snap }) + '\n')
    console.log(`\nBackup of ${snap.length} Sources: ${file}`)

    // ── Apply, one Source per transaction ──
    const ws = driver.session({ defaultAccessMode: neo4j.session.WRITE })
    try {
      for (const a of plan) {
        if (a.kind === 'rename') {
          const n = asInt((await ws.executeWrite(tx => tx.run(RENAME_QUERY, { id: a.id, to: a.to, url: a.url }))).records[0].get('n'))
          if (n !== 1) throw new Error(`rename ${a.id}: ${n} Sources matched — stopping`)
        } else if (a.kind === 'delete') {
          const n = asInt((await ws.executeWrite(tx => tx.run(DELETE_QUERY, { id: a.id }))).records[0].get('n'))
          if (n !== 1) throw new Error(`delete ${a.id}: ${n} Sources deleted — stopping`)
        } else if (a.kind === 'merge') {
          await ws.executeWrite(async tx => {
            await tx.run(MERGE_QUERIES[0], { id: a.id, into: a.into })
            const gone = asInt((await tx.run(MERGE_QUERIES[1], { id: a.id })).records[0].get('n'))
            if (gone !== 1) throw new Error(`merge ${a.id}: the padded Source still has edges — stopping`)
          })
        }
      }
    } finally { await ws.close() }

    // ── Verify ──
    const after = (await read.run(PADDED_QUERY)).records.length
    const orphans = asInt((await read.run(`MATCH (x:Source) WHERE NOT (x)--() AND x.url =~ '(?s)^\\\\s.*|.*\\\\s$' RETURN count(x) AS n`)).records[0].get('n'))
    const n = (k: string) => plan.filter(a => a.kind === k).length
    console.log(`Applied: ${n('rename')} renamed, ${n('merge')} merged, ${n('delete')} deleted. Still padded: ${after}, orphans: ${orphans}.`)
    if (after || orphans) process.exitCode = 1
  } finally {
    await read.close()
    await driver.close()
  }
}
main().catch(e => { console.error(e); process.exit(1) })
