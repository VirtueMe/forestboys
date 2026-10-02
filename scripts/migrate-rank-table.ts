/**
 * Bring the graph in line after the rank rule changes (RANKS or the
 * leading-token table in scripts/lib/person-rule.ts, kept in step with
 * parse.clj).
 *
 * - Rank nodes the table has and the graph doesn't are created, with
 *   `(Rank)-[:IN]->(Organization)` — as round_one.clj does.
 * - People are re-mapped from the Sanity name the graph was built from —
 *   the same baseline the sync's calibration uses: the name stamp when it
 *   still matches Sanity, else the April export when the node's
 *   sanityUpdatedAt equals it. Calibration held at 100 % before the rule
 *   changed, so any difference now is the rule's: canonicalName (unless
 *   saved in the editor), the known rank (unless set in the editor),
 *   serviceClass military when a rank is now parsed and there is none.
 *   A name stamp (`name_graphSha`) follows the new canonicalName. People
 *   without a baseline are left to the sync's review.
 * - Person.type follows the known rank for everyone whose type wasn't
 *   chosen in the editor: a parsed or editor-set rank makes a soldier, the
 *   Menig default a civilian.
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
import { loadEnv } from './lib/env.ts'
import { RANKS, parsePerson, rankEdge, sanMigRef, slugify } from './lib/person-rule.ts'
import { FIELDS, fetchGraphPeople, fetchSanityPeople, loadApril, neo4jDriver, sha, str, type Doc } from './lib/person-sync.ts'
loadEnv()

const write = process.argv.includes('--write')
const nameField = FIELDS.find(f => f.name === 'name')!

async function main() {
  const driver = neo4jDriver()
  const session = driver.session({ defaultAccessMode: neo4j.session.READ })
  try {
    const have = new Set((await session.run(`MATCH (r:Rank) RETURN r.slug AS slug`)).records.map(r => r.get('slug') as string))
    const newRanks = Object.entries(RANKS)
      .filter(([canonical]) => !have.has(slugify(canonical)))
      .map(([canonical, { abbrs, tier, org }]) => ({ slug: slugify(canonical), canonicalName: canonical, abbreviation: abbrs[0], tier, org }))

    const orgs = new Set((await session.run(`MATCH (o:Organization) WHERE o.slug IN $slugs RETURN o.slug AS slug`,
      { slugs: newRanks.map(r => r.org) })).records.map(r => r.get('slug') as string))
    const missingOrgs = newRanks.filter(r => !orgs.has(r.org)).map(r => `${r.slug} → ${r.org}`)
    if (missingOrgs.length) throw new Error(`Organization missing: ${missingOrgs.join(', ')}`)

    const april = loadApril()
    const [graph, sanity] = await Promise.all([
      fetchGraphPeople(),
      fetchSanityPeople().then(ds => new Map(ds.map(d => [d._id, d]))),
    ])

    const people = [...graph.values()].flatMap(g => {
      const stamp = g.stamps['name_sha']
      const current = sanity.get(g.sanityId)
      const a = april.get(g.sanityId)
      const base: Doc | undefined = stamp
        ? (current && sha(nameField.fromSanity(current)) === stamp ? current : undefined)
        : (a && a._updatedAt === g.sanityUpdatedAt ? a : undefined)
      if (!base) return []

      const parsed = parsePerson(str(base.name))
      const edge = rankEdge(g.sanityId, parsed)
      const newName = !g.adminEdited.includes('name') && g.canonicalName !== parsed.canonicalName ? parsed.canonicalName : null
      const migrationRank = !!g.knownRank?.sourceRef?.startsWith('sanity-migration:')
      const newRank = migrationRank && (g.knownRank!.rankSlug !== edge.rankSlug || g.knownRank!.sourceRef !== edge.sourceRef) ? edge : null
      const serviceClassRef = parsed.rank && !g.serviceClassSourceRef ? sanMigRef('person', g.sanityId, 'rank-parsed-from-name') : null
      if (!newName && !newRank && !serviceClassRef) return []
      const graphSha = stamp && newName ? sha(newName) : null
      return [{
        sanityId: g.sanityId, slug: g.slug,
        canonicalName: g.canonicalName, newName,
        rank: g.knownRank?.rankSlug ?? null, newRank: newRank?.rankSlug ?? null, rankRef: newRank?.sourceRef ?? null,
        serviceClassRef,
        setGraphSha: !!graphSha, nameGraphSha: graphSha && graphSha !== stamp ? graphSha : null,
      }]
    })

    const wantType = (rankRef: string | null | undefined) =>
      !rankRef ? null : rankRef.endsWith(':default:menig-soldier-baseline') ? 'civilian' : 'soldier'
    const types = [...graph.values()].flatMap(g => {
      if (g.adminEdited.includes('type')) return []
      const moved = people.find(p => p.sanityId === g.sanityId)
      const want = wantType(moved?.rankRef ?? g.knownRank?.sourceRef)
      return want && want !== g.type ? [{ sanityId: g.sanityId, slug: g.slug, from: g.type, to: want }] : []
    })

    console.log(`New ranks: ${newRanks.length ? newRanks.map(r => `${r.slug} (${r.org}, tier ${r.tier})`).join(', ') : 'none'}`)
    console.log(`People: ${people.length}`)
    for (const p of people) console.log(`  ${p.slug}: ${[
      p.newName && `"${p.canonicalName}" → "${p.newName}"`,
      p.newRank && `${p.rank} → ${p.newRank}`,
      p.serviceClassRef && 'serviceClass military',
    ].filter(Boolean).join(', ')}`)
    console.log(`Type: ${types.length}`)
    for (const t of types) console.log(`  ${t.slug}: ${t.from} → ${t.to}`)
    if (!write) { console.log('\n(dry run — pass --write to apply)'); return }

    const before = await session.run(`
      UNWIND $ids AS id MATCH (p:Person {sanityId: id})
      RETURN id, properties(p) AS props, [(p)-[k:RANK]->(r) | {rank: r.slug, props: properties(k)}] AS rank`,
      { ids: [...new Set([...people, ...types].map(p => p.sanityId))] })
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
          MATCH (p:Person {sanityId: x.sanityId})
          FOREACH (_ IN CASE WHEN x.newName IS NULL THEN [] ELSE [1] END | SET p.canonicalName = x.newName)
          FOREACH (_ IN CASE WHEN x.setGraphSha THEN [1] ELSE [] END | SET p.name_graphSha = x.nameGraphSha)
          FOREACH (_ IN CASE WHEN x.serviceClassRef IS NULL THEN [] ELSE [1] END |
            SET p.serviceClass = 'military', p.serviceClass_state = 'candidate', p.serviceClass_sourceRef = x.serviceClassRef)
          WITH p, x WHERE x.newRank IS NOT NULL
          MATCH (p)-[k:RANK]->() DELETE k
          WITH p, x MATCH (rk:Rank {slug: x.newRank})
          CREATE (p)-[:RANK {state: 'candidate', sourceRef: x.rankRef}]->(rk)`, { people })
        await tx.run(`UNWIND $types AS t MATCH (p:Person {sanityId: t.sanityId}) SET p.type = t.to`, { types })
      })
    } finally {
      await ws.close()
    }
    console.log(`Applied: ${newRanks.length} rank(s), ${people.length} people, ${types.length} types.`)
  } finally {
    await session.close()
    await driver.close()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
