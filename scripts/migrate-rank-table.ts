/**
 * Bring the graph in line after a rank is added to the rule's table
 * (RANKS in scripts/lib/person-rule.ts, kept in step with parse.clj).
 *
 * - Rank nodes the table has and the graph doesn't are created, with
 *   `(Rank)-[:IN]->(Organization)` — as round_one.clj does.
 * - People whose known rank is still the migration's and whose
 *   canonicalName now parses to one of those new ranks (the token the old
 *   table didn't know is still in the name, "2Lt Prilliman Dale") get what the rule
 *   makes of it today: canonicalName without the token, RANK to the
 *   parsed rank, serviceClass military when there is none. A name stamp
 *   (`name_graphSha`) follows the new canonicalName. Editor-set ranks are
 *   left alone.
 *
 * Afterwards scripts/sync-person.ts must calibrate at 100 % again.
 * Before writing, the affected people are saved to
 * data/sanity-delta/rank-table-before-<time>.json.
 *
 * Usage: npx tsx scripts/migrate-rank-table.ts [--write]
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import neo4j from 'neo4j-driver'
import * as dotenv from 'dotenv'
import { RANKS, parsePerson, rankEdge, sanMigRef, slugify } from './lib/person-rule.ts'
import { neo4jDriver, sha } from './lib/person-sync.ts'
dotenv.config()

const write = process.argv.includes('--write')

interface Row {
  sanityId: string
  slug: string
  canonicalName: string
  rank: string
  serviceClass: string | null
  nameSha: string | null
  nameGraphSha: string | null
}

async function main() {
  const driver = neo4jDriver()
  const session = driver.session({ defaultAccessMode: neo4j.session.READ })
  try {
    const have = new Set((await session.run(`MATCH (r:Rank) RETURN r.slug AS slug`)).records.map(r => r.get('slug') as string))
    const newRanks = Object.entries(RANKS)
      .filter(([canonical]) => !have.has(slugify(canonical)))
      .map(([canonical, { abbrs, tier, org }]) => ({ slug: slugify(canonical), canonicalName: canonical, abbreviation: abbrs[0], tier, org }))

    const added = new Set(newRanks.map(r => r.slug))

    const orgs = new Set((await session.run(`MATCH (o:Organization) WHERE o.slug IN $slugs RETURN o.slug AS slug`,
      { slugs: newRanks.map(r => r.org) })).records.map(r => r.get('slug') as string))
    const missingOrgs = newRanks.filter(r => !orgs.has(r.org)).map(r => `${r.slug} → ${r.org}`)
    if (missingOrgs.length) throw new Error(`Organization missing: ${missingOrgs.join(', ')}`)

    const rows = (await session.run(`
      MATCH (p:Person)-[k:RANK]->(rk:Rank)
      WHERE p.sanityId IS NOT NULL AND k.sourceRef STARTS WITH 'sanity-migration:'
      RETURN p.sanityId AS sanityId, p.slug AS slug, p.canonicalName AS canonicalName, rk.slug AS rank,
             p.serviceClass AS serviceClass, p.name_sha AS nameSha, p.name_graphSha AS nameGraphSha
    `)).records.map(r => r.toObject() as Row)

    const people = rows.flatMap(r => {
      const parsed = parsePerson(r.canonicalName ?? '')
      // Only ranks new to the graph: a name can carry a second rank word the
      // original parse left in on purpose ("Anton Tviberg (senere Løytnant og Kaptein)").
      if (!parsed.rank || !added.has(slugify(parsed.rank.canonical))) return []
      const edge = rankEdge(r.sanityId, parsed)
      const graphSha = r.nameSha ? sha(parsed.canonicalName) : null
      return [{
        ...r,
        newName: parsed.canonicalName,
        newRank: edge.rankSlug,
        rankRef: edge.sourceRef,
        serviceClassRef: r.serviceClass ? null : sanMigRef('person', r.sanityId, 'rank-parsed-from-name'),
        nameGraphSha: graphSha && graphSha !== r.nameSha ? graphSha : null,
      }]
    })

    console.log(`New ranks: ${newRanks.length ? newRanks.map(r => `${r.slug} (${r.org}, tier ${r.tier})`).join(', ') : 'none'}`)
    console.log(`People: ${people.length}`)
    for (const p of people) console.log(`  ${p.slug}: "${p.canonicalName}" → "${p.newName}", ${p.rank} → ${p.newRank}${p.serviceClassRef ? ', serviceClass military' : ''}`)
    if (!write) { console.log('\n(dry run — pass --write to apply)'); return }

    const before = await session.run(`
      UNWIND $ids AS id MATCH (p:Person {sanityId: id})
      RETURN id, properties(p) AS props, [(p)-[k:RANK]->(r) | {rank: r.slug, props: properties(k)}] AS rank`,
      { ids: people.map(p => p.sanityId) })
    const dir = resolve(process.cwd(), 'data', 'sanity-delta')
    mkdirSync(dir, { recursive: true })
    const file = resolve(dir, `rank-table-before-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    writeFileSync(file, JSON.stringify(before.records.map(r => r.toObject()), null, 2))
    console.log(`\nSnapshot: ${file}`)

    const ws = driver.session({ defaultAccessMode: neo4j.session.WRITE })
    try {
      await ws.executeWrite(async tx => {
        await tx.run(`
          UNWIND $ranks AS r
          MERGE (rk:Rank {slug: r.slug})
            ON CREATE SET rk.canonicalName = r.canonicalName, rk.abbreviation = r.abbreviation, rk.tier = r.tier
          WITH rk, r MATCH (o:Organization {slug: r.org})
          MERGE (rk)-[:IN]->(o)`, { ranks: newRanks })
        await tx.run(`
          UNWIND $people AS x
          MATCH (p:Person {sanityId: x.sanityId})-[k:RANK]->()
          DELETE k
          WITH p, x MATCH (rk:Rank {slug: x.newRank})
          CREATE (p)-[:RANK {state: 'candidate', sourceRef: x.rankRef}]->(rk)
          SET p.canonicalName = x.newName
          FOREACH (_ IN CASE WHEN x.serviceClassRef IS NULL THEN [] ELSE [1] END |
            SET p.serviceClass = 'military', p.serviceClass_state = 'candidate', p.serviceClass_sourceRef = x.serviceClassRef)
          FOREACH (_ IN CASE WHEN x.nameSha IS NULL THEN [] ELSE [1] END |
            SET p.name_graphSha = x.nameGraphSha)`, { people })
      })
    } finally {
      await ws.close()
    }
    console.log(`Applied: ${newRanks.length} rank(s), ${people.length} people.`)
  } finally {
    await session.close()
    await driver.close()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
