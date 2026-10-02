/**
 * Text cards whose content is a single "normal" block with a single plain span
 * are really headings stored as paragraphs (see card:home:5 — the
 * "Motstandsbevegelsen i Norge..." title bar, originally rendered as
 * <h2 class="display-4"> in Bootstrap but stored as Portable Text with
 * style: "normal").
 *
 * Promote them: move the text to c.title, delete the HAS_CONTENT edge +
 * orphaned Description node. Renderer shows kind=text cards with a title as
 * <h2>.
 *
 * Cards with real body prose (multiple blocks, marks, links) are left alone.
 *
 * Idempotent. Use --dry to preview.
 */

import neo4j from 'neo4j-driver'
import { loadEnv } from './lib/env.ts'
loadEnv()

const dry = process.argv.includes('--dry')

interface Span  { _type: 'span'; text: string; marks?: string[] }
interface Block { _type: 'block'; style?: string; children?: Span[]; markDefs?: unknown[] }

function isPureHeading(blocks: unknown): string | null {
  if (!Array.isArray(blocks) || blocks.length !== 1) return null
  const b = blocks[0] as Block
  if (b._type !== 'block') return null
  if (b.style && b.style !== 'normal' && !/^h[1-6]$/.test(b.style)) return null
  if ((b.markDefs?.length ?? 0) > 0) return null
  const children = b.children ?? []
  if (children.length !== 1) return null
  const span = children[0]
  if (span._type !== 'span') return null
  if ((span.marks?.length ?? 0) > 0) return null
  const text = (span.text ?? '').trim()
  if (!text) return null
  return text
}

async function main() {
  const driver = neo4j.driver(
    process.env.NEO4J_URI!,
    neo4j.auth.basic(process.env.NEO4J_USERNAME!, process.env.NEO4J_PASSWORD!),
  )
  const session = driver.session()

  try {
    const read = await session.run(`
      MATCH (c:Card {kind: "text"})-[:HAS_CONTENT]->(d:Description)
      RETURN c.id AS id, c.title AS title, d.id AS descId, d.content AS content
    `)

    const promotions: { cardId: string; descId: string; title: string }[] = []
    for (const rec of read.records) {
      const cardId = rec.get('id')
      const descId = rec.get('descId')
      const title  = rec.get('title')
      const content = rec.get('content')

      if (title) {
        console.log(`  SKIP ${cardId} — already has title`)
        continue
      }

      let blocks: unknown
      try { blocks = JSON.parse(content) } catch { continue }
      const heading = isPureHeading(blocks)
      if (!heading) {
        console.log(`  SKIP ${cardId} — body content (not pure heading)`)
        continue
      }
      promotions.push({ cardId, descId, title: heading })
    }

    console.log(`\nPromotions: ${promotions.length}`)
    for (const p of promotions) {
      console.log(`  ${p.cardId} → title: "${p.title}"  (remove ${p.descId})`)
    }

    if (!promotions.length || dry) {
      if (dry) console.log('\n(dry run — no writes)')
      return
    }

    await session.run(`
      UNWIND $items AS it
      MATCH (c:Card {id: it.cardId})-[r:HAS_CONTENT]->(d:Description {id: it.descId})
      SET c.title = it.title
      DELETE r, d
    `, { items: promotions })

    console.log(`\nPromoted ${promotions.length} cards.`)
  } finally {
    await session.close()
    await driver.close()
  }
}

void main().catch(e => { console.error(e); process.exit(1) })
