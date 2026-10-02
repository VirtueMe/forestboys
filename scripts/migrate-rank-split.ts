/**
 * One-shot: split ranks into the known rank and the history
 * (docs/PERSON-RANKS.md R11).
 *
 *   before  (Person)-[:HELD_RANK {state, sourceRef, from?, to?}]->(Rank)   — one list
 *   after   (Person)-[:RANK {state, sourceRef}]->(Rank)                     — exactly one
 *           (Person)-[:HELD_RANK {id, from, to, acting, state}]->(Rank)    — history, 0..n
 *
 * - A person whose only rank edge is the migration's (parsed from the
 *   Sanity name, or the Menig default) gets it as RANK, same state and
 *   sourceRef, and no history.
 * - A person edited in Grader keeps the entries as history (years become
 *   partial-date strings, fresh ids, acting false) and gets RANK from the
 *   latest entry (by `from`, then tier) — `verified`, sourceRef 'admin-edit'.
 * - People who already have RANK are skipped (idempotent).
 *
 * Checks afterwards: every Person has exactly one RANK, no migration edge
 * is left in the history, every history entry has an id.
 *
 * Usage: npx tsx scripts/migrate-rank-split.ts [--write]
 */

import { randomUUID } from 'node:crypto'
import neo4j from 'neo4j-driver'
import { loadEnv } from './lib/env.ts'
loadEnv()

const write = process.argv.includes('--write')

interface Row {
  slug:  string
  edges: { rank: string; tier: number | null; state: string | null; sourceRef: string | null; from: number | string | null; to: number | string | null }[]
}

const isMigration = (ref: string | null) => !!ref?.startsWith('sanity-migration:')

async function main() {
  const driver = neo4j.driver(
    process.env.NEO4J_URI!,
    neo4j.auth.basic(process.env.NEO4J_USERNAME!, process.env.NEO4J_PASSWORD!),
    { disableLosslessIntegers: true },
  )
  console.log(`Target: ${process.env.NEO4J_URI?.replace(/\/\/([^:/]+).*/, '//$1')}`)
  const session = driver.session()
  try {
    const r = await session.run(`
      MATCH (p:Person) WHERE NOT (p)-[:RANK]->()
      OPTIONAL MATCH (p)-[h:HELD_RANK]->(rk:Rank)
      RETURN p.slug AS slug,
             [x IN collect(CASE WHEN rk IS NULL THEN NULL ELSE {
               rank: rk.slug, tier: rk.tier, state: h.state, sourceRef: h.sourceRef, from: h.from, to: h.to
             } END) WHERE x IS NOT NULL] AS edges`)
    const rows = r.records.map(rec => rec.toObject() as Row)

    const moves: { slug: string; rank: string; state: string | null; sourceRef: string | null }[] = []
    const edited: { slug: string; rank: string; history: { id: string; rank: string; from: string | null; to: string | null }[] }[] = []
    const errors: string[] = []

    for (const row of rows) {
      const mig = row.edges.filter(e => isMigration(e.sourceRef))
      if (!row.edges.length) { errors.push(`${row.slug}: no rank at all`); continue }
      if (mig.length === row.edges.length) {
        if (mig.length !== 1) { errors.push(`${row.slug}: ${mig.length} migration ranks`); continue }
        if (mig[0].from != null || mig[0].to != null) { errors.push(`${row.slug}: migration rank has dates`); continue }
        moves.push({ slug: row.slug, rank: mig[0].rank, state: mig[0].state, sourceRef: mig[0].sourceRef })
        continue
      }
      if (mig.length) { errors.push(`${row.slug}: migration and editor ranks mixed`); continue }
      const latest = [...row.edges].sort((a, b) =>
        String(b.from ?? '').localeCompare(String(a.from ?? '')) || (b.tier ?? 0) - (a.tier ?? 0))[0]
      edited.push({
        slug: row.slug, rank: latest.rank,
        history: row.edges.map(e => ({
          id: randomUUID(), rank: e.rank,
          from: e.from == null ? null : String(e.from),
          to:   e.to   == null ? null : String(e.to),
        })),
      })
    }

    console.log(`People without RANK: ${rows.length}`)
    console.log(`  migration rank → RANK:            ${moves.length}`)
    console.log(`  edited in Grader → RANK + history: ${edited.length}${edited.length ? ` (${edited.map(e => `${e.slug}: ${e.rank}, ${e.history.length} entr${e.history.length === 1 ? 'y' : 'ies'}`).join('; ')})` : ''}`)
    if (errors.length) {
      console.error(`\nErrors (${errors.length}):\n  ${errors.join('\n  ')}\n\nRefusing to write.`)
      process.exitCode = 1
      return
    }
    if (!write) { console.log('\n(dry run — pass --write to migrate)'); return }

    await session.executeWrite(async tx => {
      await tx.run(`
        UNWIND $moves AS m
        MATCH (p:Person {slug: m.slug})-[h:HELD_RANK]->(rk:Rank {slug: m.rank})
        DELETE h
        CREATE (p)-[:RANK {state: m.state, sourceRef: m.sourceRef}]->(rk)`, { moves })
      await tx.run(`
        UNWIND $edited AS e
        MATCH (p:Person {slug: e.slug})
        OPTIONAL MATCH (p)-[old:HELD_RANK]->()
        DELETE old
        WITH DISTINCT p, e
        MATCH (known:Rank {slug: e.rank})
        CREATE (p)-[:RANK {state: 'verified', sourceRef: 'admin-edit'}]->(known)
        WITH p, e
        UNWIND e.history AS h
        MATCH (rk:Rank {slug: h.rank})
        CREATE (p)-[:HELD_RANK {id: h.id, from: h.from, to: h.to, acting: false, state: 'verified'}]->(rk)`, { edited })
    })

    const check = await session.run(`
      MATCH (p:Person)
      WITH count(p) AS people,
           count(CASE WHEN COUNT { (p)-[:RANK]->() } <> 1 THEN 1 END) AS notOneRank
      OPTIONAL MATCH ()-[h:HELD_RANK]->()
      RETURN people, notOneRank,
             count(CASE WHEN h.sourceRef STARTS WITH 'sanity-migration:' THEN 1 END) AS migrationInHistory,
             count(CASE WHEN h IS NOT NULL AND h.id IS NULL THEN 1 END) AS historyWithoutId,
             count(h) AS history`)
    const c = check.records[0].toObject() as Record<string, number>
    console.log(`\nAfter: ${c.people} people · without exactly one RANK: ${c.notOneRank} · history entries: ${c.history}` +
      ` (migration edges left: ${c.migrationInHistory}, without id: ${c.historyWithoutId})`)
    if (c.notOneRank || c.migrationInHistory || c.historyWithoutId) process.exitCode = 1
  } finally {
    await session.close()
    await driver.close()
  }
}
void main().catch(e => { console.error(e); process.exit(1) })
