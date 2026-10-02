/**
 * Field-level sync report for Sanity `person` documents (docs/SANITY-SYNC.md,
 * "Sync" step 2). Read-only.
 *
 * For every person changed in Sanity, each changed field is compared three
 * ways — its baseline (stamp or April export), current Sanity, and the
 * graph — and classified (scripts/lib/person-sync.ts):
 *
 *   already       the graph already holds what the rule makes of the new value
 *   clean         graph still equals its baseline → the Sanity change can apply
 *   conflict      graph differs from its baseline → edited in the graph, review
 *   review        no trustworthy baseline, so graph edits can't be told apart
 *   not-imported  the graph holds nothing for this field on this person
 *
 * Calibration runs first: on people unchanged in Sanity, the graph must
 * equal what the rule (scripts/lib/person-rule.ts) makes of the baseline.
 *
 * Output: data/sanity-delta/person-fields.json + a summary.
 *
 * Usage: npx tsx scripts/sanity-person-fields.ts
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadEnv } from './lib/env.ts'
import {
  FIELDS, calibrate, classify, fetchGraphPeople, fetchSanityPeople, loadApril, str,
  type FieldVerdict, type Verdict,
} from './lib/person-sync.ts'
loadEnv()

const OUT_DIR = resolve(process.cwd(), 'data', 'sanity-delta')

async function main() {
  const april = loadApril()
  const [sanityDocs, graph] = await Promise.all([fetchSanityPeople(), fetchGraphPeople()])
  const sanity = new Map(sanityDocs.map(d => [d._id, d]))

  const calib = calibrate(graph, sanity, april)

  const rows: { slug: string; sanityId: string; name: string; fields: FieldVerdict[] }[] = []
  const tally: Record<string, Record<Verdict, number>> = {}
  for (const f of FIELDS) tally[f.name] = { already: 0, clean: 0, conflict: 0, review: 0, 'not-imported': 0 }

  for (const g of graph.values()) {
    const s = sanity.get(g.sanityId)
    if (!s) continue
    const fields = classify(g, s, april.get(g.sanityId))
    for (const f of fields) tally[f.field][f.verdict]++
    if (fields.length) rows.push({ slug: g.slug, sanityId: g.sanityId, name: str(s.name), fields })
  }

  const newPeople = sanityDocs.filter(d => !graph.has(d._id))
  const deleted = [...graph.values()].filter(g => !sanity.has(g.sanityId))
  const settled = (v: Verdict) => v === 'clean' || v === 'already' || v === 'not-imported'
  const perPerson = {
    allClean:     rows.filter(r => r.fields.every(f => settled(f.verdict))).length,
    withConflict: rows.filter(r => r.fields.some(f => f.verdict === 'conflict')).length,
    withReview:   rows.filter(r => r.fields.some(f => f.verdict === 'review')).length,
  }

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(resolve(OUT_DIR, 'person-fields.json'), JSON.stringify({
    generatedAt: new Date().toISOString(), calibration: calib, tally, perPerson, changed: rows,
    new: newPeople.map(d => ({ id: d._id, name: d.name, updatedAt: d._updatedAt })),
    deleted: deleted.map(g => ({ id: g.sanityId, slug: g.slug, name: g.canonicalName, rels: g.rels, graphOnlyRels: g.graphOnlyRels })),
  }, null, 2) + '\n')

  console.log('Calibration — unchanged people, graph vs rule(baseline):')
  for (const [name, c] of Object.entries(calib)) {
    console.log(`  ${name.padEnd(12)} ${(100 * c.agree / c.total).toFixed(1).padStart(5)}%  (${c.total - c.agree} of ${c.total} differ)`)
  }
  console.log(`\nChanged people: ${rows.length} — all clean: ${perPerson.allClean} · with conflict: ${perPerson.withConflict} · with review: ${perPerson.withReview}`)
  console.log('field         already  clean  conflict  review  not-imported')
  for (const [f, t] of Object.entries(tally)) {
    console.log(`  ${f.padEnd(12)} ${String(t.already).padStart(6)} ${String(t.clean).padStart(6)} ${String(t.conflict).padStart(9)} ${String(t.review).padStart(7)} ${String(t['not-imported']).padStart(13)}`)
  }
  console.log(`\nNew in Sanity: ${newPeople.length}`)
  console.log(`Deleted in Sanity: ${deleted.length}` + deleted.map(g => `\n  ${g.slug} (${g.rels} edges, ${g.graphOnlyRels} not from Sanity)`).join(''))
  console.log('\nDetails: data/sanity-delta/person-fields.json')
}
void main().catch(e => { console.error(e); process.exit(1) })
