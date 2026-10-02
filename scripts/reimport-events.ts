/**
 * Re-import every Sanity event as it is now (docs/SANITY-SYNC.md, "Events").
 *
 * The graph's events were still almost exactly what the April import made
 * of them (scripts/sanity-event-fields.ts: calibration all but one field),
 * so rather than sync 379 changed, 104 new and 20 deleted events one by
 * one, they are replaced:
 *
 *   1. Backup — every Sanity event node, every edge touching it and its
 *      imported Description → data/sanity-delta/events-before-<time>.json.
 *   2. Graph additions are kept aside: edges on the events the import did
 *      not make (editor-added people, person notes, AT, hierarchy …).
 *   3. Delete the events with a sanityId and their `desc:event:` Descriptions.
 *      Sources (links, images) are shared and stay.
 *   4. Create them again from Sanity with the original rule — as Operations
 *      (an Incident is proposed per event later, as a bundle):
 *        node      slug, codeName (title), date, type 'unclassified', sanityId, sanityUpdatedAt
 *        edges     ORCHESTRATED_BY, IN_DISTRICT, FROM, TO, FROM_STATION, TO_STATION, USED,
 *                  Person PARTICIPATED_IN {state: 'verified', sourceRef: 'sanity-event-migration'}
 *        images    HAS_IMAGE {order, caption?} → Source img:sanity:<asset>
 *        links     REFERENCED_IN → Source (person-rule linkSource)
 *        text      (:Description {id: 'desc:event:<id>', …})-[:ABOUT]->
 *      A reference to a document the graph doesn't have is dropped and counted.
 *   5. Re-attach the graph additions by the event's sanityId (MERGE — where
 *      Sanity now has the same edge, the import's version stands).
 *   6. The Sanity events taken in become the new baseline
 *      (EVENT_BASELINE), and SyncState event.importedUpTo is set.
 *
 * EXCLUDED_EVENT_SLUGS (the WT station template) are left out.
 *
 * Usage: npx tsx scripts/reimport-events.ts [--write]
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import neo4j from 'neo4j-driver'
import { loadEnv } from './lib/env.ts'
import { neo4jDriver } from './lib/person-sync.ts'
import { EVENT_BASELINE, fetchSanityEvents } from './lib/event-sync.ts'
import { SINGLE, PARTICIPANT_EDGE, loadLookups, planEvent, slugOf } from './lib/event-rule.ts'
loadEnv()

const write = process.argv.includes('--write')
const CHUNK = 200

/** Edges the import makes; everything else on an event was added in the graph. */
const IMPORT_EDGE = `
  CASE
    WHEN type(r) IN ['PARTICIPATED_IN', 'INVOLVED_IN'] THEN coalesce(r.sourceRef, '') STARTS WITH 'sanity'
    WHEN type(r) = 'ABOUT' THEN coalesce(o.id, '') = 'desc:event:' + e.sanityId
    WHEN type(r) IN ['ORCHESTRATED_BY', 'IN_DISTRICT', 'FROM', 'TO', 'FROM_STATION', 'TO_STATION', 'USED', 'HAS_IMAGE', 'REFERENCED_IN']
      THEN startNode(r) = e
    ELSE false
  END`

interface Extra {
  event: string; slug: string; type: string; out: boolean
  otherLabel: string; otherKey: 'slug' | 'id'; other: string; props: Record<string, unknown>
}

async function main() {
  const docs = await fetchSanityEvents()
  const driver = neo4jDriver()
  const read = driver.session({ defaultAccessMode: neo4j.session.READ })
  try {
    const lookups = await loadLookups(read)

    // ── Plan the new events (scripts/lib/event-rule.ts) ──
    const unresolved: Record<string, { n: number; samples: string[] }> = {}
    const nodes: Record<string, unknown>[] = []
    const edges: Record<string, { event: string; target: string }[]> = {}
    const people: { event: string; target: string }[] = []
    const transport: { event: string; target: string }[] = []
    const images: Record<string, unknown>[] = []
    const links: Record<string, unknown>[] = []
    const descriptions: Record<string, unknown>[] = []
    const errors: string[] = []

    const seenSlugs = new Map<string, string>()
    for (const d of docs) {
      const slug = slugOf(d)
      if (!slug) { errors.push(`no slug: ${d._id}`); continue }
      if (seenSlugs.has(slug)) errors.push(`slug twice in Sanity: ${slug} (${seenSlugs.get(slug)}, ${d._id})`)
      seenSlugs.set(slug, d._id)

      const p = planEvent(d, lookups)
      nodes.push(p.node)
      for (const e of p.single) (edges[e.type] ??= []).push({ event: d._id, target: e.target })
      for (const t of p.people) people.push({ event: d._id, target: t })
      for (const t of p.transport) transport.push({ event: d._id, target: t })
      for (const img of p.images) images.push({ event: d._id, ...img })
      for (const src of p.links) links.push({ event: d._id, source: src })
      if (p.description) descriptions.push({ event: d._id, props: p.description })
      for (const u of p.unresolved) {
        const x = (unresolved[u.field] ??= { n: 0, samples: [] })
        x.n++
        if (x.samples.length < 4) x.samples.push(`${slug} → ${u.id}`)
      }
    }

    // ── What is there now ──
    const now = await read.run(`
      MATCH (e) WHERE (e:Operation OR e:Incident) AND e.sanityId IS NOT NULL
      OPTIONAL MATCH (d:Description)-[:ABOUT]->(e) WHERE d.id = 'desc:event:' + e.sanityId
      RETURN count(DISTINCT e) AS events, count(d) AS descs`)
    const before = { events: now.records[0].get('events') as number, descriptions: now.records[0].get('descs') as number }

    const extras = (await read.run(`
      MATCH (e) WHERE (e:Operation OR e:Incident) AND e.sanityId IS NOT NULL
      MATCH (e)-[r]-(o)
      WITH e, r, o WHERE NOT (${IMPORT_EDGE})
      RETURN e.sanityId AS event, e.slug AS slug, type(r) AS type, startNode(r) = e AS out,
             labels(o)[0] AS otherLabel, CASE WHEN o.slug IS NOT NULL THEN 'slug' ELSE 'id' END AS otherKey,
             coalesce(o.slug, o.id) AS other, properties(r) AS props`)).records.map(x => x.toObject() as Extra)
    const sanityIds = new Set(docs.map(d => d._id))
    const orphanExtras = extras.filter(x => !sanityIds.has(x.event))

    // Slugs a graph-made event already holds.
    const taken = (await read.run(`
      MATCH (e) WHERE (e:Operation OR e:Incident) AND e.sanityId IS NULL AND e.slug IN $slugs RETURN e.slug AS slug`,
      { slugs: [...seenSlugs.keys()] })).records.map(x => x.get('slug') as string)
    for (const s of taken) errors.push(`slug held by a graph-made event: ${s}`)

    // ── Report ──
    const count = (xs: unknown[]) => xs.length
    console.log(`Sanity events: ${docs.length} (template excluded)`)
    console.log(`Graph now: ${before.events} events, ${before.descriptions} imported descriptions — deleted`)
    console.log(`\nTo create: ${nodes.length} Operations`)
    for (const s of SINGLE) console.log(`  ${s.type.padEnd(16)} ${count(edges[s.type] ?? [])}`)
    console.log(`  ${'PARTICIPATED_IN'.padEnd(16)} ${people.length}`)
    console.log(`  ${'USED'.padEnd(16)} ${transport.length}`)
    console.log(`  ${'HAS_IMAGE'.padEnd(16)} ${images.length}`)
    console.log(`  ${'REFERENCED_IN'.padEnd(16)} ${links.length}`)
    console.log(`  ${'Description'.padEnd(16)} ${descriptions.length}`)
    console.log(`\nReferences the graph doesn't have (dropped):`)
    for (const [f, u] of Object.entries(unresolved)) console.log(`  ${f.padEnd(13)} ${u.n}  e.g. ${u.samples.join(', ')}`)
    if (!Object.keys(unresolved).length) console.log('  none')
    console.log(`\nGraph additions to re-attach: ${extras.length}`)
    for (const x of extras) {
      const gone = !sanityIds.has(x.event) ? '  ← event deleted in Sanity' : ''
      console.log(`  ${x.slug}: ${x.out ? '→' : '←'} ${x.type} ${x.otherLabel} ${x.other}${gone}`)
    }
    if (errors.length) console.log(`\nErrors (${errors.length}):\n  ${errors.join('\n  ')}`)

    if (!write) { console.log('\n(dry run — pass --write to apply)'); return }
    if (errors.length) { console.error('\nRefusing to write: fix the errors first.'); process.exitCode = 1; return }
    if (orphanExtras.length) {
      console.error(`\nRefusing to write: ${orphanExtras.length} graph additions sit on events deleted in Sanity.`)
      process.exitCode = 1
      return
    }

    // ── 1. Backup ──
    const backup = await read.run(`
      MATCH (e) WHERE (e:Operation OR e:Incident) AND e.sanityId IS NOT NULL
      RETURN labels(e) AS labels, properties(e) AS props,
             [(e)-[r]-(o) | {type: type(r), out: startNode(r) = e, otherLabel: labels(o)[0],
                             other: coalesce(o.slug, o.id), props: properties(r)}] AS edges,
             [(d:Description)-[:ABOUT]->(e) WHERE d.id = 'desc:event:' + e.sanityId | properties(d)] AS descriptions`)
    const dir = resolve(process.cwd(), 'data', 'sanity-delta')
    mkdirSync(dir, { recursive: true })
    const file = resolve(dir, `events-before-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    writeFileSync(file, JSON.stringify({ extras, events: backup.records.map(r => r.toObject()) }) + '\n')
    console.log(`\nBackup: ${file}`)

    const ws = driver.session({ defaultAccessMode: neo4j.session.WRITE })
    const chunks = <T>(xs: T[]) => Array.from({ length: Math.ceil(xs.length / CHUNK) }, (_, i) => xs.slice(i * CHUNK, (i + 1) * CHUNK))
    const run = async (text: string, rows: unknown[], key = 'rows') => {
      for (const c of chunks(rows)) await ws.executeWrite(tx => tx.run(text, { [key]: c }))
    }
    try {
      // ── 3. Delete ──
      const ids = backup.records.map(r => (r.get('props') as { sanityId: string }).sanityId)
      await run(`
        UNWIND $rows AS id
        MATCH (e {sanityId: id}) WHERE e:Operation OR e:Incident
        OPTIONAL MATCH (d:Description)-[:ABOUT]->(e) WHERE d.id = 'desc:event:' + id
        DETACH DELETE d, e`, ids)
      console.log(`Deleted ${ids.length} events.`)

      // ── 4. Create ──
      await run(`UNWIND $rows AS n CREATE (e:Operation) SET e = n`, nodes)
      for (const s of SINGLE) {
        await run(`
          UNWIND $rows AS x
          MATCH (e:Operation {sanityId: x.event}), (t:\`${s.label}\` {slug: x.target})
          MERGE (e)-[:\`${s.type}\`]->(t)`, edges[s.type] ?? [])
      }
      await run(`
        UNWIND $rows AS x
        MATCH (e:Operation {sanityId: x.event}), (p:Person {slug: x.target})
        MERGE (p)-[r:PARTICIPATED_IN]->(e)
        SET r.state = '${PARTICIPANT_EDGE.state}', r.sourceRef = '${PARTICIPANT_EDGE.sourceRef}'`, people)
      await run(`
        UNWIND $rows AS x
        MATCH (e:Operation {sanityId: x.event}), (t:Transport {slug: x.target})
        MERGE (e)-[:USED]->(t)`, transport)
      await run(`
        UNWIND $rows AS img
        MATCH (e:Operation {sanityId: img.event})
        MERGE (s:Source {id: img.id})
          ON CREATE SET s.type = 'photograph', s.url = img.url, s.sanityAssetRef = img.assetRef
        MERGE (e)-[h:HAS_IMAGE]->(s)
        SET h.order = img.order, h.caption = img.caption`, images)
      await run(`
        UNWIND $rows AS l
        MATCH (e:Operation {sanityId: l.event})
        MERGE (s:Source {id: l.source.id}) ON CREATE SET s += l.source
        MERGE (e)-[:REFERENCED_IN]->(s)`, links)
      await run(`
        UNWIND $rows AS x
        MATCH (e:Operation {sanityId: x.event})
        CREATE (d:Description)-[:ABOUT]->(e) SET d = x.props`, descriptions)
      console.log(`Created ${nodes.length} Operations.`)

      // ── 5. Re-attach graph additions ──
      for (const x of extras) {
        const other = `(o:\`${x.otherLabel}\` {${x.otherKey}: $other})`
        const rel = x.out ? `(e)-[r:\`${x.type}\`]->(o)` : `(e)<-[r:\`${x.type}\`]-(o)`
        await ws.executeWrite(tx => tx.run(`
          MATCH (e:Operation {sanityId: $event}), ${other}
          MERGE ${rel} ON CREATE SET r = $props`, { event: x.event, other: x.other, props: x.props }))
      }
      console.log(`Re-attached ${extras.length} graph additions.`)

      // ── 6. Baseline + marker ──
      mkdirSync(dirname(resolve(process.cwd(), EVENT_BASELINE)), { recursive: true })
      writeFileSync(resolve(process.cwd(), EVENT_BASELINE), JSON.stringify(docs, null, 1) + '\n')
      const newest = docs.map(d => d._updatedAt).reduce((a, b) => (b > a ? b : a))
      await ws.run(`MERGE (s:SyncState {source: 'sanity', type: 'event'}) SET s.importedUpTo = $newest, s.at = datetime()`, { newest })
      console.log(`Baseline: ${EVENT_BASELINE} · SyncState event.importedUpTo = ${newest}`)
    } finally {
      await ws.close()
    }
  } finally {
    await read.close()
    await driver.close()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
