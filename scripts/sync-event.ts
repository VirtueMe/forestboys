/**
 * Apply the Sanity → graph sync for events (docs/SANITY-SYNC.md, "Events").
 * A plain bridge: it carries Jan's edits over and makes no judgements —
 * classification and structure are separate analysis jobs that propose
 * bundles.
 *
 * Per field, against its baseline (scripts/lib/event-sync.ts):
 *   clean     → applied with the import's rule (scripts/lib/event-rule.ts)
 *   already   → only the stamp moves
 *   conflict  → left alone, listed (Sanity changed and the graph was edited)
 *   review    → left alone, listed (no baseline)
 * New events are created as Operations. Events deleted in Sanity are
 * listed; `--accept-delete=<slug>,…` deletes them, unless something was
 * added to them in the graph.
 *
 * Every applied event is stamped (`<field>_sha` for every field), so the
 * next run compares against what was taken in. The first run stamps all
 * events from the baseline file (EVENT_BASELINE) — after that the graph
 * carries its own baseline.
 *
 * Refuses to write unless calibration is 100%. Before writing, the
 * affected events (node, edges, description) are saved to
 * data/sanity-delta/event-before-<time>.json.
 *
 * Usage: npx tsx scripts/sync-event.ts [--write] [--accept-delete=<slug>,…]
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import neo4j, { type ManagedTransaction } from 'neo4j-driver'
import * as dotenv from 'dotenv'
import { neo4jDriver, type Doc } from './lib/person-sync.ts'
import {
  EVENT_FIELDS, calibrateEvents, classifyEvent, fetchGraphEvents, fetchSanityEvents,
  loadAprilEvents, stampsFor, type EventVerdict, type GraphEvent,
} from './lib/event-sync.ts'
import {
  PARTICIPANT_EDGE, SINGLE, descriptionProps, eventImages, eventLinks, loadLookups, planEvent, ref, refs, slugOf, str,
  writeEvent, type Lookups,
} from './lib/event-rule.ts'
dotenv.config()

const write = process.argv.includes('--write')
const acceptDelete = new Set(
  (process.argv.find(a => a.startsWith('--accept-delete='))?.slice('--accept-delete='.length) ?? '')
    .split(',').map(x => x.trim()).filter(Boolean))
const OUT = resolve(process.cwd(), 'data', 'sanity-delta', 'event-sync-plan.json')

type Stmt = { text: string; params: Record<string, unknown> }
const E = 'MATCH (e {sanityId: $id}) WHERE e:Operation OR e:Incident'

/** Statements that make the graph hold Sanity's value for one field. */
function applyField(field: string, g: GraphEvent, d: Doc, l: Lookups): Stmt[] {
  const id = g.sanityId
  const single = SINGLE.find(s => s.field === field)
  if (single) {
    const target = l[single.label as keyof Lookups].get(ref(d[field]))
    return [{
      text: `${E}
             OPTIONAL MATCH (e)-[r:\`${single.type}\`]->() DELETE r
             WITH DISTINCT e
             OPTIONAL MATCH (t:\`${single.label}\` {slug: $target})
             FOREACH (_ IN CASE WHEN t IS NULL THEN [] ELSE [1] END | MERGE (e)-[:\`${single.type}\`]->(t))`,
      params: { id, target: target ?? null },
    }]
  }
  switch (field) {
    case 'title': {
      const prop = g.label === 'Operation' ? 'codeName' : 'title'
      return [{ text: `${E} SET e.${prop} = $v`, params: { id, v: str(d.title) } }]
    }
    case 'slug':
      return [{ text: `${E} SET e.slug = $v`, params: { id, v: slugOf(d) } }]
    case 'date':
      return [{ text: `${E} SET e.date = $v`, params: { id, v: str(d.date) || null } }]
    case 'people': {
      // Only the import's links are Sanity's to change — editor additions stay.
      const edge = g.label === 'Operation' ? 'PARTICIPATED_IN' : 'INVOLVED_IN'
      const slugs = refs(d.people).map(x => l.Person.get(x)).filter((x): x is string => !!x)
      return [{
        text: `${E}
               OPTIONAL MATCH (p:Person)-[r:PARTICIPATED_IN|INVOLVED_IN]->(e)
                 WHERE coalesce(r.sourceRef, '') STARTS WITH 'sanity' AND NOT p.slug IN $slugs
               DELETE r
               WITH DISTINCT e
               UNWIND $slugs AS slug
               MATCH (p:Person {slug: slug})
               MERGE (p)-[r:\`${edge}\`]->(e) ON CREATE SET r = $edge`,
        params: { id, slugs, edge: PARTICIPANT_EDGE },
      }]
    }
    case 'transport': {
      const slugs = refs(d.transport).map(x => l.Transport.get(x)).filter((x): x is string => !!x)
      return [{
        text: `${E}
               OPTIONAL MATCH (e)-[r:USED]->(t:Transport) WHERE NOT t.slug IN $slugs DELETE r
               WITH DISTINCT e
               UNWIND $slugs AS slug MATCH (t:Transport {slug: slug}) MERGE (e)-[:USED]->(t)`,
        params: { id, slugs },
      }]
    }
    case 'gallery': {
      const images = eventImages(d)
      return [{
        text: `${E}
               OPTIONAL MATCH (e)-[r:HAS_IMAGE]->(s:Source)
                 WHERE s.url STARTS WITH 'https://cdn.sanity.io/' AND NOT s.id IN $ids
               DELETE r
               WITH DISTINCT e
               UNWIND $images AS img
               MERGE (s:Source {id: img.id}) ON CREATE SET s.type = 'photograph', s.url = img.url, s.sanityAssetRef = img.assetRef
               MERGE (e)-[h:HAS_IMAGE]->(s) SET h.order = img.order, h.caption = img.caption`,
        params: { id, ids: images.map(i => i.id), images },
      }]
    }
    case 'links': {
      const links = eventLinks(d)
      return [{
        text: `${E}
               OPTIONAL MATCH (e)-[r:REFERENCED_IN]->(s:Source)
                 WHERE coalesce(r.sourceRef, '') <> 'admin-edit' AND NOT s.id IN $ids
               DELETE r
               WITH DISTINCT e
               UNWIND $links AS src
               MERGE (s:Source {id: src.id}) ON CREATE SET s += src
               MERGE (e)-[:REFERENCED_IN]->(s)`,
        params: { id, ids: links.map(s => s.id), links },
      }]
    }
    case 'description': {
      const props = descriptionProps(d)
      return [{
        text: `${E}
               OPTIONAL MATCH (old:Description)-[:ABOUT]->(e) WHERE old.id = 'desc:event:' + $id DETACH DELETE old
               WITH DISTINCT e
               FOREACH (_ IN CASE WHEN $props IS NULL THEN [] ELSE [1] END |
                 CREATE (d:Description)-[:ABOUT]->(e) SET d = $props)`,
        params: { id, props },
      }]
    }
  }
  throw new Error(`no apply rule for ${field}`)
}

interface Plan { id: string; slug: string; summary: string[]; stmts: Stmt[] }

async function main() {
  const base = loadAprilEvents()
  const [sanityDocs, graph] = await Promise.all([fetchSanityEvents(), fetchGraphEvents()])
  const sanity = new Map(sanityDocs.map(d => [d._id, d]))
  const driver = neo4jDriver()
  const read = driver.session({ defaultAccessMode: neo4j.session.READ })
  const errors: string[] = []
  try {
    const l = await loadLookups(read)
    const calib = calibrateEvents(graph, sanity, base, l)
    const off = Object.entries(calib).filter(([, c]) => c.agree !== c.total)
    console.log(`Calibration: ${off.length ? off.map(([n, c]) => `${n} ${c.total - c.agree} differ`).join(', ') : `graph equals its baseline (${Object.values(calib)[0]?.total ?? 0} events)`}`)

    // Events not stamped yet: stamp them from the baseline file (first run).
    const toStamp = [...graph.values()].filter(g => !Object.keys(g.stamps).length && base.get(g.sanityId)?._updatedAt === g.sanityUpdatedAt)

    // Changed in Sanity.
    const skipped: string[] = []
    const changed: Plan[] = []
    const verdictCount: Record<string, Record<EventVerdict, number>> = {}
    for (const g of graph.values()) {
      const s = sanity.get(g.sanityId)
      if (!s) continue
      const fields = classifyEvent(g, s, base.get(g.sanityId), l)
      if (!fields.length) continue
      const plan: Plan = { id: g.sanityId, slug: g.slug, summary: [], stmts: [] }
      for (const { field, verdict } of fields) {
        ;(verdictCount[field] ??= { already: 0, clean: 0, conflict: 0, review: 0 })[verdict]++
        if (verdict === 'conflict' || verdict === 'review') { skipped.push(`${g.slug}: ${field} (${verdict})`); continue }
        if (verdict === 'clean') { plan.stmts.push(...applyField(field, g, s, l)); plan.summary.push(field) }
      }
      // Stamp the fields taken in; a conflict or review field keeps its old stamp.
      const held = new Set(fields.filter(f => f.verdict === 'conflict' || f.verdict === 'review').map(f => f.field))
      const stamps = Object.fromEntries(Object.entries(stampsFor(s, l)).filter(([k]) => !held.has(k.replace(/_sha$/, ''))))
      plan.stmts.push({ text: `${E} SET e += $stamps, e.sanityUpdatedAt = $at`, params: { id: g.sanityId, stamps, at: s._updatedAt } })
      changed.push(plan)
    }

    // New in Sanity.
    const created = sanityDocs.filter(d => !graph.has(d._id)).map(d => ({ doc: d, plan: planEvent(d, l) }))
    const taken = new Set((await read.run(`MATCH (e) WHERE e:Operation OR e:Incident RETURN e.slug AS slug`)).records.map(r => r.get('slug') as string))
    for (const c of created) if (taken.has(slugOf(c.doc))) errors.push(`slug taken: ${slugOf(c.doc)}`)

    // Deleted in Sanity: what the graph added to them blocks a delete.
    const deleted = [...graph.values()].filter(g => !sanity.has(g.sanityId))
    const additions = new Map<string, string[]>()
    for (const g of deleted) {
      const r = await read.run(`
        ${E}
        MATCH (e)-[r]-(o)
        WHERE NOT (
          (type(r) IN ['PARTICIPATED_IN', 'INVOLVED_IN'] AND coalesce(r.sourceRef, '') STARTS WITH 'sanity') OR
          (type(r) = 'ABOUT' AND coalesce(o.id, '') = 'desc:event:' + $id) OR
          (type(r) IN ['ORCHESTRATED_BY','IN_DISTRICT','FROM','TO','FROM_STATION','TO_STATION','USED','HAS_IMAGE'] AND startNode(r) = e) OR
          (type(r) = 'REFERENCED_IN' AND coalesce(r.sourceRef, '') <> 'admin-edit'))
        RETURN type(r) + ' ' + coalesce(o.slug, o.id) AS what`, { id: g.sanityId })
      additions.set(g.sanityId, r.records.map(x => x.get('what') as string))
    }
    for (const slug of acceptDelete) {
      const g = deleted.find(x => x.slug === slug)
      if (!g) errors.push(`--accept-delete: ${slug} is not deleted in Sanity`)
      else if (additions.get(g.sanityId)?.length) errors.push(`--accept-delete: ${slug} has graph additions: ${additions.get(g.sanityId)!.join('; ')}`)
    }

    // ── Report ──
    console.log(`\nFirst-run stamps: ${toStamp.length} events`)
    console.log(`Changed in Sanity: ${changed.length}`)
    for (const [f, v] of Object.entries(verdictCount).sort()) console.log(`  ${f.padEnd(13)} ${Object.entries(v).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(', ')}`)
    console.log(`New in Sanity: ${created.length}`)
    for (const c of created) console.log(`  + ${slugOf(c.doc)} — ${str(c.doc.title).slice(0, 70)}${c.plan.unresolved.length ? ` (${c.plan.unresolved.length} unresolved refs)` : ''}`)
    console.log(`Deleted in Sanity: ${deleted.length}`)
    for (const g of deleted) {
      const add = additions.get(g.sanityId) ?? []
      console.log(`  ${acceptDelete.has(g.slug) ? '✓' : ' '} ${g.slug} — ${g.name ?? ''}${add.length ? `  BLOCKED: ${add.join('; ')}` : ''}`)
    }
    console.log(`Left alone: ${skipped.length} field(s)`)
    for (const s of skipped.slice(0, 20)) console.log(`  ${s}`)
    if (errors.length) console.log(`\nErrors (${errors.length}):\n  ${errors.join('\n  ')}`)

    mkdirSync(resolve(OUT, '..'), { recursive: true })
    writeFileSync(OUT, JSON.stringify({
      generatedAt: new Date().toISOString(), calibration: calib, errors, skipped,
      changed: changed.map(c => ({ slug: c.slug, summary: c.summary })),
      created: created.map(c => ({ slug: slugOf(c.doc), title: c.doc.title, unresolved: c.plan.unresolved })),
      deleted: deleted.map(g => ({ slug: g.slug, name: g.name, additions: additions.get(g.sanityId) ?? [], accepted: acceptDelete.has(g.slug) })),
    }, null, 2) + '\n')
    console.log(`Plan: ${OUT}`)

    if (!write) { console.log('\n(dry run — pass --write to apply)'); return }
    if (off.length || errors.length) {
      console.error('\nRefusing to write: calibration must be 100% and there must be no errors.')
      process.exitCode = 1
      return
    }

    // ── Backup ──
    const touched = [...changed.map(c => c.id), ...deleted.filter(g => acceptDelete.has(g.slug)).map(g => g.sanityId)]
    const snap = await read.run(`
      UNWIND $ids AS id MATCH (e {sanityId: id}) WHERE e:Operation OR e:Incident
      RETURN labels(e) AS labels, properties(e) AS props,
             [(e)-[r]-(o) | {type: type(r), out: startNode(r) = e, other: coalesce(o.slug, o.id), props: properties(r)}] AS edges,
             [(d:Description)-[:ABOUT]->(e) WHERE d.id = 'desc:event:' + id | properties(d)] AS descriptions`, { ids: touched })
    const file = resolve(OUT, '..', `event-before-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    writeFileSync(file, JSON.stringify({ created: created.map(c => c.doc._id), events: snap.records.map(r => r.toObject()) }) + '\n')
    console.log(`\nBackup of ${snap.records.length} events: ${file}`)

    const ws = driver.session({ defaultAccessMode: neo4j.session.WRITE })
    try {
      if (toStamp.length) {
        const rows = toStamp.map(g => ({ id: g.sanityId, stamps: stampsFor(base.get(g.sanityId)!, l) }))
        for (let i = 0; i < rows.length; i += 200) {
          await ws.executeWrite(tx => tx.run(`
            UNWIND $rows AS x MATCH (e {sanityId: x.id}) WHERE e:Operation OR e:Incident SET e += x.stamps`,
            { rows: rows.slice(i, i + 200) }))
        }
        console.log(`Stamped ${toStamp.length} events from the baseline.`)
      }
      for (const p of changed) {
        await ws.executeWrite(async (tx: ManagedTransaction) => { for (const s of p.stmts) await tx.run(s.text, s.params) })
      }
      for (const c of created) {
        await ws.executeWrite(tx => writeEvent(tx, c.plan, stampsFor(c.doc, l)))
      }
      for (const g of deleted.filter(x => acceptDelete.has(x.slug))) {
        await ws.executeWrite(tx => tx.run(`
          ${E}
          OPTIONAL MATCH (d:Description)-[:ABOUT]->(e) WHERE d.id = 'desc:event:' + $id
          DETACH DELETE d, e`, { id: g.sanityId }))
      }
      const newest = sanityDocs.map(d => d._updatedAt).reduce((a, b) => (b > a ? b : a))
      await ws.run(`MERGE (s:SyncState {source: 'sanity', type: 'event'}) SET s.importedUpTo = $newest, s.at = datetime()`, { newest })
      console.log(`Applied: ${changed.length} changed, ${created.length} new, ${acceptDelete.size} deleted. SyncState event.importedUpTo = ${newest}`)
    } finally {
      await ws.close()
    }
  } finally {
    await read.close()
    await driver.close()
  }
}

// Fields with an apply rule must match the compared fields.
for (const f of EVENT_FIELDS) if (!['title', 'slug', 'date', 'people', 'transport', 'gallery', 'links', 'description', ...SINGLE.map(s => s.field)].includes(f.name)) {
  throw new Error(`EVENT_FIELDS has ${f.name} without an apply rule`)
}
main().catch(e => { console.error(e); process.exit(1) })
