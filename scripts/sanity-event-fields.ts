/**
 * Field-level sync report for Sanity `event` documents (docs/SANITY-SYNC.md,
 * "Events"). Read-only — the baseline before any event bundle is made.
 *
 * Calibration first: events unchanged in Sanity since April must have graph
 * fields equal to the April export (scripts/lib/event-sync.ts). Then, per
 * event changed in Sanity, each changed field is classified:
 *
 *   already   the graph already holds the new value
 *   clean     graph still equals the April value → the Sanity change can apply
 *   conflict  graph differs from April → edited in the graph
 *   review    no trustworthy baseline
 *
 * Plus events new in Sanity, events deleted in Sanity, and graph edits on
 * events Sanity hasn't touched.
 *
 * Output: data/sanity-delta/event-fields.json + a summary.
 *
 * Usage: npx tsx scripts/sanity-event-fields.ts
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import * as dotenv from 'dotenv'
import {
  EVENT_FIELDS, baselineSha, calibrateEvents, classifyEvent, fetchGraphEvents, fetchSanityEvents, loadAprilEvents, sha,
  type EventVerdict,
} from './lib/event-sync.ts'
import { loadLookups } from './lib/event-rule.ts'
import { neo4jDriver } from './lib/person-sync.ts'
dotenv.config()

const OUT = resolve(process.cwd(), 'data', 'sanity-delta', 'event-fields.json')

async function main() {
  const april = loadAprilEvents()
  const [sanityDocs, graph] = await Promise.all([fetchSanityEvents(), fetchGraphEvents()])
  const sanity = new Map(sanityDocs.map(d => [d._id, d]))

  const driver = neo4jDriver(), session = driver.session()
  const lookups = await loadLookups(session).finally(() => session.close().then(() => driver.close()))
  const calib = calibrateEvents(graph, sanity, april, lookups)
  const created = sanityDocs.filter(d => !graph.has(d._id))
  const deleted = [...graph.values()].filter(g => !sanity.has(g.sanityId))

  let unchanged = 0, noBaseline = 0
  const changed: { slug: string; label: string; fields: { field: string; verdict: EventVerdict }[] }[] = []
  const graphEdits: { slug: string; fields: string[] }[] = []
  for (const g of graph.values()) {
    const s = sanity.get(g.sanityId)
    if (!s) continue
    const base = april.get(g.sanityId)
    if (!EVENT_FIELDS.some(f => baselineSha(g, f, base, lookups) !== undefined)) noBaseline++
    if (s._updatedAt === g.sanityUpdatedAt) {
      unchanged++
      // Sanity untouched since it was taken in: a difference from the baseline is a graph edit.
      const fields = EVENT_FIELDS.filter(f => {
        const b = baselineSha(g, f, base, lookups)
        return b !== undefined && sha(f.fromGraph(g)) !== b
      }).map(f => f.name)
      if (fields.length) graphEdits.push({ slug: g.slug, fields })
      continue
    }
    const fields = classifyEvent(g, s, base, lookups)
    if (fields.length) changed.push({ slug: g.slug, label: g.label, fields })
  }

  const byField: Record<string, Record<EventVerdict, number>> = {}
  for (const c of changed) for (const { field, verdict } of c.fields) {
    const f = (byField[field] ??= { already: 0, clean: 0, conflict: 0, review: 0 })
    f[verdict]++
  }

  const off = Object.entries(calib).filter(([, c]) => c.agree !== c.total)
  console.log(`Sanity events: ${sanityDocs.length} · graph events: ${graph.size} · baseline: ${april.size}`)
  console.log(`Calibration (unchanged since the baseline, graph = baseline): ${off.length
    ? off.map(([n, c]) => `${n} ${c.total - c.agree}/${c.total} differ`).join(', ')
    : `all fields agree (${Object.values(calib)[0]?.total ?? 0} events)`}`)
  console.log(`\nUnchanged in Sanity since import: ${unchanged}  (no April baseline: ${noBaseline})`)
  console.log(`Changed in Sanity: ${changed.length}`)
  for (const [field, v] of Object.entries(byField).sort()) {
    console.log(`  ${field.padEnd(13)} ${Object.entries(v).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(', ')}`)
  }
  console.log(`New in Sanity: ${created.length}`)
  console.log(`Deleted in Sanity: ${deleted.length}`)
  console.log(`Edited in the graph, Sanity unchanged: ${graphEdits.length}`)
  const editFields: Record<string, number> = {}
  for (const e of graphEdits) for (const f of e.fields) editFields[f] = (editFields[f] ?? 0) + 1
  if (graphEdits.length) console.log(`  ${Object.entries(editFields).map(([f, n]) => `${f} ${n}`).join(', ')}`)

  mkdirSync(resolve(OUT, '..'), { recursive: true })
  writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(), calibration: calib,
    changed, byField, graphEdits,
    created: created.map(d => ({ id: d._id, slug: (d.slug as { current?: string } | undefined)?.current, title: d.title, date: d.date, updatedAt: d._updatedAt })),
    deleted: deleted.map(g => ({ id: g.sanityId, slug: g.slug, label: g.label, name: g.name })),
  }, null, 2) + '\n')
  console.log(`\nReport: ${OUT}`)
}

main().catch(e => { console.error(e); process.exit(1) })
