/**
 * Round 1.5 — flatten page cards to order/kind/layout model.
 *
 * Reads existing Card nodes attached to Page {slug: "home"|"about"}, computes
 *   - order:   global integer (top first, then middle, then bottom; within each,
 *              sectionOrder ascending)
 *   - kind:    "text" for cards that came from "middle" (intro/title bar),
 *              "card" otherwise
 *   - layout:  "full" for kind=text (middle is always full-width),
 *              otherwise derived from how many cards share the section:
 *                1 → "full", 2 → "half", 3 → "third", ≥4 → "quarter"
 *
 * Idempotent — safe to re-run. Does NOT delete the old section/sectionOrder
 * properties yet; that's a follow-up once the new model is in production.
 *
 * Usage:
 *   npx tsx scripts/flatten-page-cards.ts
 *   npx tsx scripts/flatten-page-cards.ts --dry
 */

import neo4j from 'neo4j-driver'
import { loadEnv } from '../lib/env.ts'

loadEnv()

const dry = process.argv.includes('--dry')

const NEO4J_URI      = process.env.NEO4J_URI      ?? 'bolt://localhost:7687'
const NEO4J_USERNAME = process.env.NEO4J_USERNAME ?? 'neo4j'
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD ?? 'localdev'

const SECTION_RANK: Record<string, number> = { top: 0, middle: 1, bottom: 2 }
const LAYOUT_BY_COUNT: Record<number, string> = { 1: 'full', 2: 'half', 3: 'third' }

interface CardRow {
  id:           string
  slug:         string
  section:      string
  sectionOrder: number
}

function planLayout(kind: string, count: number): string {
  if (kind === 'text') return 'full'
  return LAYOUT_BY_COUNT[count] ?? 'quarter'
}

async function main() {
  const driver  = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD))
  const session = driver.session()

  try {
    const read = await session.run(`
      MATCH (p:Page)-[:HAS_CARD]->(c:Card)
      WHERE p.slug IN ["home", "about"]
      RETURN c.id AS id, p.slug AS slug, c.section AS section, c.sectionOrder AS sectionOrder
    `)
    const cards: CardRow[] = read.records.map(r => ({
      id:           r.get('id'),
      slug:         r.get('slug'),
      section:      r.get('section') ?? 'middle',
      sectionOrder: Number(r.get('sectionOrder') ?? 0),
    }))

    const updates: { id: string; order: number; kind: string; layout: string }[] = []

    for (const slug of ['home', 'about']) {
      const pageCards = cards
        .filter(c => c.slug === slug)
        .sort((a, b) => {
          const sa = SECTION_RANK[a.section] ?? 99
          const sb = SECTION_RANK[b.section] ?? 99
          return sa - sb || a.sectionOrder - b.sectionOrder
        })

      const sectionCounts: Record<string, number> = {}
      for (const c of pageCards) sectionCounts[c.section] = (sectionCounts[c.section] ?? 0) + 1

      pageCards.forEach((c, i) => {
        const kind   = c.section === 'middle' ? 'text' : 'card'
        const layout = planLayout(kind, sectionCounts[c.section] ?? 1)
        updates.push({ id: c.id, order: i + 1, kind, layout })
      })
    }

    console.log(`Planned updates: ${updates.length}`)
    for (const u of updates) {
      console.log(`  ${u.id.padEnd(18)} order=${String(u.order).padStart(2)}  kind=${u.kind.padEnd(5)}  layout=${u.layout}`)
    }

    if (dry) {
      console.log('\n(dry run — no writes)')
      return
    }

    await session.run(`
      UNWIND $items AS it
      MATCH (c:Card {id: it.id})
      SET c.order  = it.order,
          c.kind   = it.kind,
          c.layout = it.layout
    `, { items: updates })

    console.log(`\nWrote ${updates.length} cards.`)
  } finally {
    await session.close()
    await driver.close()
  }
}

void main().catch(e => { console.error(e); process.exit(1) })
