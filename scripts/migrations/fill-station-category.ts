/**
 * Fill Station.category from the free-text `type` (#303), and tidy the stray types.
 *
 *   category  set where the station has none and its type suggests one (src/utils/stationCategory.ts); a category
 *             that is set is never touched. A type that suggests nothing is listed for Jan, not guessed.
 *   type      the three misspellings of «Airfield» become «Airfield»; a type that is a pair of coordinates is removed
 *             (the old value is printed). Every other type stays as written: the category carries the grouping.
 *
 * Each write is guarded on the value read (`category IS NULL`, `type = <old>`), so a station edited meanwhile is skipped.
 * The type was edited in the graph, so the station sync (#297) leaves it as it is; it never touches `category`.
 *
 * Usage: npx tsx scripts/migrations/fill-station-category.ts [--production] [--write]
 */

import { loadEnv } from '../lib/env.ts'
import { connectNeo4j } from '../lib/person-sync.ts'
import { planStationCategories } from '../lib/station-category-fill.ts'
import { STATION_CATEGORY_LABEL } from '../../src/utils/stationCategory.ts'
loadEnv()

const write = process.argv.includes('--write')

async function main() {
  const driver = await connectNeo4j()
  const session = driver.session()
  try {
    const r = await session.run(`
      MATCH (s:Station)
      RETURN s.slug AS slug, coalesce(s.canonicalName, s.title) AS name, s.type AS type, s.category AS category
      ORDER BY s.slug`)
    const plan = planStationCategories(r.records.map(x => ({
      slug: x.get('slug'), name: x.get('name'), type: x.get('type'), category: x.get('category'),
    })))

    console.log(`${r.records.length} stations · category already set: ${plan.kept} · to fill: ${plan.fills.length} · unclear: ${plan.unclear.length}`)
    for (const c of ['training', 'base', 'airfield', 'other'] as const) {
      const n = plan.fills.filter(f => f.category === c).length
      console.log(`  ${STATION_CATEGORY_LABEL[c].padEnd(9)} ${n}`)
    }
    if (plan.types.length) {
      console.log(`\nTypes to tidy (${plan.types.length}):`)
      for (const t of plan.types) console.log(`  ${t.slug}: "${t.from}" → ${t.to === null ? '(removed)' : `"${t.to}"`}`)
    }
    if (plan.unclear.length) {
      console.log(`\nNo category suggested, for Jan (${plan.unclear.length}):`)
      for (const u of plan.unclear) console.log(`  ${u.slug} "${u.name ?? ''}": ${u.type === null ? '(no type)' : `"${u.type}"`}`)
    }

    if (!write) { console.log('\n(dry run — pass --write to apply)'); return }

    // The type first: a tidied type is the one the category was suggested from.
    const tidied = await session.run(`
      UNWIND $rows AS row
      MATCH (s:Station {slug: row.slug}) WHERE s.type = row.from
      SET s.type = row.to
      RETURN count(*) AS n`, { rows: plan.types })
    const filled = await session.run(`
      UNWIND $rows AS row
      MATCH (s:Station {slug: row.slug}) WHERE s.category IS NULL
      SET s.category = row.category
      RETURN count(*) AS n`, { rows: plan.fills })
    const nTypes = tidied.records[0]?.get('n') as number
    const nFills = filled.records[0]?.get('n') as number
    console.log(`\nTidied ${nTypes} / ${plan.types.length} types · set ${nFills} / ${plan.fills.length} categories`)
    if (nTypes !== plan.types.length || nFills !== plan.fills.length) process.exitCode = 1
  } finally {
    await session.close()
    await driver.close()
  }
}
void main().catch(e => { console.error(e); process.exit(1) })
