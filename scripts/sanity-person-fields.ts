/**
 * Field-level sync report for Sanity `person` documents (docs/SANITY-SYNC.md,
 * "Sync" step 2). Read-only.
 *
 * For every person changed in Sanity since the baseline, each changed field
 * is compared three ways — baseline (what the graph imported), current
 * Sanity, and the graph — and classified:
 *
 *   already   the graph already holds the new Sanity value
 *   clean     graph still equals the baseline → the Sanity change can apply
 *   conflict  graph differs from the baseline → edited in the graph, review
 *   review    baseline not trustworthy for this person (its _updatedAt ≠ the
 *             node's sanityUpdatedAt), so graph edits can't be told apart
 *   not-imported  the graph holds nothing for this field on this person
 *             (person descriptions were never imported — Sanity is the
 *             only copy), so there is nothing to sync yet
 *
 * Calibration: the same graph-vs-baseline comparison is run on people who
 * have NOT changed in Sanity. Agreement there should be near 100%; the
 * rest are graph edits or a comparator that doesn't model the import.
 *
 * Inputs: data/sanity-baseline-2026-04/sanity-person.json (baseline),
 * current Sanity via api.sanity.io, the graph.
 * Output: data/sanity-delta/person-fields.json + a summary.
 *
 * Usage: npx tsx scripts/sanity-person-fields.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import neo4j from 'neo4j-driver'
import * as dotenv from 'dotenv'
dotenv.config()

const API      = 'https://7r6kqtqy.api.sanity.io/v2021-08-31/data/query/production'
const BASELINE = 'data/sanity-baseline-2026-04/sanity-person.json'
const OUT_DIR  = resolve(process.cwd(), 'data', 'sanity-delta')

type Doc = Record<string, unknown> & { _id: string; _updatedAt: string }

interface GraphPerson {
  sanityId:        string
  sanityUpdatedAt: string | null
  slug:            string
  canonicalName:   string | null
  secretName:      string | null
  home:            string | null
  birthYear:       number | null
  links:           string[]
  images:          string[]
  content:         string[]
  rels:            number
  graphOnlyRels:   number
}

// ── Normalisers: Sanity field → the comparable value the graph should hold ──

const ws = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Sanity scalar → string; anything else (missing, object) → ''. */
const str = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '')

function ptText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ''
  return ws(blocks.map(b => {
    const kids = (b as { children?: { text?: string }[] }).children ?? []
    return kids.map(c => c.text ?? '').join('')
  }).join('\n'))
}

/** image-<hash>-<WxH>-<ext> → <hash>-<WxH>.<ext>, the tail of the CDN url. */
function imageKey(ref: string): string {
  const m = ref.match(/^image-([a-f0-9]+-\d+x\d+)-(\w+)$/)
  return m ? `${m[1]}.${m[2]}` : ref
}

const sortedJoin = (xs: string[]) => [...new Set(xs)].sort().join('\n')

/** The name import strips rank tokens, so the canonical name's words appear in order in the name. */
function nameMatches(canonical: string | null, name: unknown): boolean {
  if (!canonical || typeof name !== 'string') return !canonical && !name
  const want = ws(canonical).toLowerCase().split(' ')
  const have = ws(name).toLowerCase().split(' ')
  let i = 0
  for (const w of have) if (w === want[i]) i++
  return i === want.length
}

interface Field {
  sanity: string
  /** Comparable form of the Sanity value. */
  fromSanity: (d: Doc) => string
  /** Comparable form of the graph value. */
  fromGraph:  (g: GraphPerson) => string
  /** Custom equality when the import is lossy (name). */
  same?: (g: GraphPerson, d: Doc) => boolean
  /** False when the graph holds nothing for this field on this person. */
  imported?: (g: GraphPerson) => boolean
}

const FIELDS: Field[] = [
  { sanity: 'name',
    fromSanity: d => ws(str(d.name)),
    fromGraph:  g => g.canonicalName ?? '',
    same:       (g, d) => nameMatches(g.canonicalName, d.name) },
  { sanity: 'secretName', fromSanity: d => ws(str(d.secretName)), fromGraph: g => ws(g.secretName ?? '') },
  { sanity: 'home',       fromSanity: d => ws(str(d.home)),       fromGraph: g => ws(g.home ?? '') },
  { sanity: 'birthYear',  fromSanity: d => str(d.birthYear),      fromGraph: g => String(g.birthYear ?? '') },
  { sanity: 'slug',
    fromSanity: d => String((d.slug as { current?: string } | undefined)?.current ?? ''),
    fromGraph:  g => g.slug },
  { sanity: 'links',
    fromSanity: d => sortedJoin(((d.links as { link?: string }[] | undefined) ?? []).map(l => (l.link ?? '').trim()).filter(Boolean)),
    fromGraph:  g => sortedJoin(g.links.map(u => u.trim())) },
  { sanity: 'gallery',
    fromSanity: d => sortedJoin(((d.gallery as { asset?: { _ref?: string } }[] | undefined) ?? [])
      .map(i => i.asset?._ref).filter((r): r is string => !!r).map(imageKey)),
    fromGraph:  g => sortedJoin(g.images) },
  { sanity: 'description',
    fromSanity: d => ptText(d.description),
    fromGraph:  g => ws(g.content.map(c => { try { return ptText(JSON.parse(c)) } catch { return '' } }).join('\n')),
    imported:   g => g.content.length > 0 },
]

function same(f: Field, g: GraphPerson, d: Doc): boolean {
  return f.same ? f.same(g, d) : f.fromGraph(g) === f.fromSanity(d)
}

// ── Data ──

async function fetchSanityPeople(): Promise<Doc[]> {
  const out: Doc[] = []
  let lastId = ''
  for (;;) {
    const url = new URL(API)
    url.searchParams.set('query',
      `*[_type == "person" && !(_id in path("drafts.**")) && _id > $lastId] | order(_id asc) [0...1000]`)
    url.searchParams.set('$lastId', JSON.stringify(lastId))
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Sanity ${res.status}`)
    const page = (await res.json() as { result: Doc[] }).result
    out.push(...page)
    if (page.length < 1000) return out
    lastId = page[page.length - 1]._id
  }
}

async function fetchGraphPeople(): Promise<Map<string, GraphPerson>> {
  const driver = neo4j.driver(
    process.env.NEO4J_URI!,
    neo4j.auth.basic(process.env.NEO4J_USERNAME!, process.env.NEO4J_PASSWORD!),
    { disableLosslessIntegers: true },
  )
  const session = driver.session({ defaultAccessMode: neo4j.session.READ })
  try {
    const r = await session.run(`
      MATCH (p:Person) WHERE p.sanityId IS NOT NULL
      CALL {
        WITH p
        OPTIONAL MATCH (p)-[:REFERENCED_IN]->(s:Source)
        RETURN [u IN collect(s.url) WHERE u IS NOT NULL] AS links
      }
      CALL {
        WITH p
        OPTIONAL MATCH (p)-[:HAS_IMAGE]->(i:Source) WHERE i.url STARTS WITH 'https://cdn.sanity.io/'
        RETURN [u IN collect(i.url) | last(split(u, '/'))] AS images
      }
      CALL {
        WITH p
        OPTIONAL MATCH (p)-[:HAS_CONTENT]->(d:Description)
        WITH d ORDER BY coalesce(d.order, 1)
        RETURN [c IN collect(d.content) WHERE c IS NOT NULL] AS content
      }
      CALL {
        WITH p
        OPTIONAL MATCH (p)-[r]-()
        RETURN count(r) AS rels,
               count(CASE WHEN r.sourceRef IS NULL OR NOT r.sourceRef STARTS WITH 'sanity' THEN 1 END) AS graphOnlyRels
      }
      RETURN p.sanityId AS sanityId, p.sanityUpdatedAt AS sanityUpdatedAt, p.slug AS slug,
             p.canonicalName AS canonicalName, p.secretName AS secretName, p.home AS home,
             p.birthYear AS birthYear, links, images, content, rels, graphOnlyRels
    `)
    return new Map(r.records.map(rec => {
      const g = rec.toObject() as GraphPerson
      return [g.sanityId, g]
    }))
  } finally {
    await session.close()
    await driver.close()
  }
}

// ── Report ──

type Verdict = 'already' | 'clean' | 'conflict' | 'review' | 'not-imported'

async function main() {
  const baseline = new Map((JSON.parse(readFileSync(BASELINE, 'utf8')) as Doc[]).map(d => [d._id, d]))
  const [sanity, graph] = await Promise.all([fetchSanityPeople(), fetchGraphPeople()])
  const sanityById = new Map(sanity.map(d => [d._id, d]))

  // Calibration: unchanged in Sanity, baseline trustworthy → graph should equal baseline.
  const calib = FIELDS.map(f => ({ field: f.sanity, agree: 0, total: 0, samples: [] as unknown[] }))
  for (const g of graph.values()) {
    const b = baseline.get(g.sanityId)
    const s = sanityById.get(g.sanityId)
    if (!b || !s || s._updatedAt !== b._updatedAt || b._updatedAt !== g.sanityUpdatedAt) continue
    FIELDS.forEach((f, i) => {
      if (f.imported && !f.imported(g)) return
      const c = calib[i]
      c.total++
      if (same(f, g, b)) c.agree++
      else if (c.samples.length < 5) c.samples.push({ slug: g.slug, graph: f.fromGraph(g).slice(0, 120), baseline: f.fromSanity(b).slice(0, 120) })
    })
  }

  // Changed people.
  const rows: { slug: string; sanityId: string; name: string; trusted: boolean; fields: { field: string; verdict: Verdict }[] }[] = []
  const tally: Record<string, Record<Verdict, number>> = {}
  for (const f of FIELDS) tally[f.sanity] = { already: 0, clean: 0, conflict: 0, review: 0, 'not-imported': 0 }

  for (const g of graph.values()) {
    const s = sanityById.get(g.sanityId)
    if (!s || (g.sanityUpdatedAt && s._updatedAt <= g.sanityUpdatedAt)) continue
    const b = baseline.get(g.sanityId)
    const base = b && b._updatedAt === g.sanityUpdatedAt ? b : null
    const trusted = !!base
    const fields: { field: string; verdict: Verdict }[] = []
    for (const f of FIELDS) {
      // Changed = differs from what the graph was built from (or, untrusted, from the graph).
      const changed = base ? f.fromSanity(s) !== f.fromSanity(base) : !same(f, g, s)
      if (!changed) continue
      const verdict: Verdict =
        f.imported && !f.imported(g) ? 'not-imported'
        : same(f, g, s)  ? 'already'
        : !base          ? 'review'
        : same(f, g, base) ? 'clean'
        : 'conflict'
      fields.push({ field: f.sanity, verdict })
      tally[f.sanity][verdict]++
    }
    if (fields.length) rows.push({ slug: g.slug, sanityId: g.sanityId, name: str(s.name), trusted, fields })
  }

  const newPeople = sanity.filter(d => !graph.has(d._id))
  const deleted = [...graph.values()].filter(g => !sanityById.has(g.sanityId))

  const perPerson = {
    allClean:     rows.filter(r => r.fields.every(f => ['clean', 'already', 'not-imported'].includes(f.verdict))).length,
    withConflict: rows.filter(r => r.fields.some(f => f.verdict === 'conflict')).length,
    withReview:   rows.filter(r => r.fields.some(f => f.verdict === 'review')).length,
  }

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(resolve(OUT_DIR, 'person-fields.json'), JSON.stringify({
    generatedAt: new Date().toISOString(), calibration: calib, tally, perPerson, changed: rows,
    new: newPeople.map(d => ({ id: d._id, name: d.name, updatedAt: d._updatedAt })),
    deleted: deleted.map(g => ({ id: g.sanityId, slug: g.slug, name: g.canonicalName, rels: g.rels, graphOnlyRels: g.graphOnlyRels })),
  }, null, 2) + '\n')

  console.log('Calibration — unchanged people, graph vs baseline:')
  for (const c of calib) {
    console.log(c.total
      ? `  ${c.field.padEnd(12)} ${(100 * c.agree / c.total).toFixed(1).padStart(5)}%  (${c.total - c.agree} differ)`
      : `  ${c.field.padEnd(12)}     —   (not imported for anyone)`)
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
