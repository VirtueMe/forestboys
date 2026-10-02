/**
 * Shared by the person sync report (scripts/sanity-person-fields.ts) and
 * the apply step (scripts/sync-person.ts) — one set of verdicts for both.
 * docs/SANITY-SYNC.md, "Sync".
 *
 * Every field is reduced to a comparable string. The baseline for a field
 * is, in order:
 *   1. its stamp on the Person — `<field>_sha` (hash of the Sanity value
 *      taken in) and `<field>_graphSha` (hash of the graph value right
 *      after; defaults to `<field>_sha`), written when the field was
 *      imported or applied after April;
 *   2. the April export, when the document's _updatedAt equals the node's
 *      sanityUpdatedAt;
 *   3. none — the field goes to review, or to conflict when the editor
 *      marked it (`<field>_sourceRef: 'admin-edit'`).
 */

import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import neo4j from 'neo4j-driver'
import { stableJson } from './sanity-sha.ts'
import { isImportableUrl, parsePerson, rankEdge, urlToId, imageSources } from './person-rule.ts'

export const API      = 'https://7r6kqtqy.api.sanity.io/v2021-08-31/data/query/production'
export const BASELINE = 'data/sanity-baseline-2026-04/sanity-person.json'

export type Doc = Record<string, unknown> & { _id: string; _updatedAt: string }

export interface GraphPerson {
  sanityId:        string
  sanityUpdatedAt: string | null
  slug:            string
  canonicalName:   string | null
  secretName:      string | null
  home:            string | null
  birthYear:       number | null
  status:          string | null
  statusSourceRef: string | null
  serviceClass:    string | null
  serviceClassSourceRef: string | null
  links:           string[]
  linkIds:         string[]
  images:          string[]
  imageIds:        string[]
  /** The known rank — `(Person)-[:RANK]->(Rank)`, docs/PERSON-RANKS.md. The history is not synced. */
  knownRank:       { rankSlug: string; sourceRef: string | null } | null
  content:         string[]
  stamps:          Record<string, string>
  /** Fields (sync names) saved in the editor — `<prop>_sourceRef: 'admin-edit'`. */
  adminEdited:     string[]
  rels:            number
  graphOnlyRels:   number
}

// ── Comparable forms ──

const ws  = (s: string) => s.replace(/\s+/g, ' ').trim()
export const str = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '')
export const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const sortedJoin = (xs: string[]) => [...new Set(xs)].sort().join('\n')

export const sanityLinks = (d: Doc) =>
  ((d.links as { link?: string }[] | undefined) ?? []).map(l => l.link ?? '').filter(isImportableUrl)

/** image-<hash>-<WxH>-<ext> → <hash>-<WxH>.<ext>, the tail of the CDN url. */
function imageKey(ref: string): string {
  const m = /^image-([a-f0-9]+-\d+x\d+)-(\w+)$/.exec(ref)
  return m ? `${m[1]}.${m[2]}` : ref
}

export interface Field {
  name: string
  /** Comparable form of the Sanity value. */
  fromSanity: (d: Doc) => string
  /** Comparable form of the graph value — what the rule makes of `fromSanity`. */
  fromGraph:  (g: GraphPerson) => string
  /** Comparable form of what the rule would make of a Sanity doc, when it isn't `fromSanity` (name). */
  ruleOf?:    (d: Doc) => string
  /** False when the graph holds nothing for this field on this person. */
  imported?:  (g: GraphPerson) => boolean
}

export const FIELDS: Field[] = [
  { name: 'name',
    fromSanity: d => ws(str(d.name)),
    fromGraph:  g => g.canonicalName ?? '',
    ruleOf:     d => parsePerson(str(d.name)).canonicalName },
  { name: 'secretName', fromSanity: d => ws(str(d.secretName)), fromGraph: g => ws(g.secretName ?? '') },
  { name: 'home',       fromSanity: d => ws(str(d.home)),       fromGraph: g => ws(g.home ?? '') },
  { name: 'birthYear',  fromSanity: d => str(d.birthYear),      fromGraph: g => String(g.birthYear ?? '') },
  { name: 'slug',
    fromSanity: d => String((d.slug as { current?: string } | undefined)?.current ?? ''),
    fromGraph:  g => g.slug },
  { name: 'links',
    fromSanity: d => sortedJoin(sanityLinks(d)),
    fromGraph:  g => sortedJoin(g.links) },
  { name: 'gallery',
    fromSanity: d => sortedJoin(((d.gallery as { asset?: { _ref?: string } }[] | undefined) ?? [])
      .map(i => i.asset?._ref).filter((r): r is string => !!r).map(imageKey)),
    fromGraph:  g => sortedJoin(g.images) },
  { name: 'description',
    fromSanity: d => stableJson(d.description ?? null),
    // Sections concatenate back into one block list; a single imported section is unchanged by this.
    fromGraph:  g => stableJson(g.content.flatMap(c => { try { return JSON.parse(c) as unknown[] } catch { return [] } })),
    imported:   g => g.content.length > 0 },
]

/** What the graph should hold if it took `d` in. */
export const ruleValue = (f: Field, d: Doc) => (f.ruleOf ?? f.fromSanity)(d)

/** Stamp values to write after a field is applied or imported. */
export function stampFor(f: Field, d: Doc): Record<string, string> {
  const out: Record<string, string> = { [`${f.name}_sha`]: sha(f.fromSanity(d)) }
  const graphSha = sha(ruleValue(f, d))
  if (graphSha !== out[`${f.name}_sha`]) out[`${f.name}_graphSha`] = graphSha
  return out
}

// ── Verdicts ──

export type Verdict = 'already' | 'clean' | 'conflict' | 'review' | 'not-imported'

export interface FieldVerdict { field: string; verdict: Verdict }

/**
 * Per changed field of one person: compare current Sanity (`s`) with the
 * field's baseline, and the graph with what the rule made of that baseline.
 */
export function classify(g: GraphPerson, s: Doc, april: Doc | undefined): FieldVerdict[] {
  const base = april && april._updatedAt === g.sanityUpdatedAt ? april : null
  const out: FieldVerdict[] = []
  for (const f of FIELDS) {
    const stamp = g.stamps[`${f.name}_sha`]
    const graphNow = f.fromGraph(g)
    const graphHasNew = graphNow === ruleValue(f, s)

    if (stamp) {
      if (sha(f.fromSanity(s)) === stamp) continue
      const graphStamp = g.stamps[`${f.name}_graphSha`] ?? stamp
      out.push({ field: f.name, verdict: graphHasNew ? 'already' : sha(graphNow) === graphStamp ? 'clean' : 'conflict' })
      continue
    }
    const changed = base ? f.fromSanity(s) !== f.fromSanity(base) : !graphHasNew
    if (!changed) continue
    out.push({
      field: f.name,
      verdict:
        f.imported && !f.imported(g) ? 'not-imported'
        : graphHasNew                ? 'already'
        : !base                      ? (g.adminEdited.includes(f.name) ? 'conflict' : 'review')
        : graphNow === ruleValue(f, base) ? 'clean'
        : 'conflict',
    })
  }
  return out
}

/**
 * Calibration: for people unchanged in Sanity with a trustworthy baseline,
 * the graph must equal what the rule makes of the baseline — both for the
 * compared fields and for what the rule derives (rank edge, status,
 * serviceClass, Source ids). Anything else is a graph edit or a rule that
 * doesn't match the original import.
 */
export function calibrate(graph: Map<string, GraphPerson>, sanity: Map<string, Doc>, april: Map<string, Doc>) {
  const checks: Record<string, { agree: number; total: number; samples: unknown[] }> = {}
  const check = (name: string, ok: boolean, sample: () => unknown) => {
    const c = (checks[name] ??= { agree: 0, total: 0, samples: [] })
    c.total++
    if (ok) c.agree++
    else if (c.samples.length < 5) c.samples.push(sample())
  }

  for (const g of graph.values()) {
    const b = april.get(g.sanityId)
    const s = sanity.get(g.sanityId)
    if (!b || !s || s._updatedAt !== b._updatedAt || b._updatedAt !== g.sanityUpdatedAt) continue

    for (const f of FIELDS) {
      if (f.imported && !f.imported(g)) continue
      const stamp = g.stamps[`${f.name}_sha`]
      const want = stamp ? (g.stamps[`${f.name}_graphSha`] ?? stamp) : ruleValue(f, b)
      const have = stamp ? sha(f.fromGraph(g)) : f.fromGraph(g)
      check(f.name, want === have, () => ({ slug: g.slug, graph: f.fromGraph(g).slice(0, 120), rule: ruleValue(f, b).slice(0, 120) }))
    }

    // Derived by the rule, not compared field by field.
    const parsed = parsePerson(str(b.name))
    if (g.knownRank?.sourceRef?.startsWith('sanity-migration:')) {
      const want = rankEdge(g.sanityId, parsed)
      const have = g.knownRank
      check('rank', have.rankSlug === want.rankSlug && have.sourceRef === want.sourceRef,
        () => ({ slug: g.slug, graph: have, rule: want }))
    }
    if (g.statusSourceRef?.startsWith('sanity-migration:')) {
      check('status', g.status === parsed.status?.value, () => ({ slug: g.slug, graph: g.status, rule: parsed.status }))
    }
    if (g.serviceClassSourceRef?.endsWith(':rank-parsed-from-name')) {
      check('serviceClass', !!parsed.rank, () => ({ slug: g.slug, name: b.name }))
    }
    check('linkIds', sortedJoin(g.linkIds) === sortedJoin(sanityLinks(b).map(urlToId)),
      () => ({ slug: g.slug, graph: g.linkIds, rule: sanityLinks(b).map(urlToId) }))
    check('imageIds', sortedJoin(g.imageIds) === sortedJoin(imageSources(b.gallery).map(i => i.id)),
      () => ({ slug: g.slug, graph: g.imageIds, rule: imageSources(b.gallery).map(i => i.id) }))
  }
  return checks
}

// ── Data ──

export const loadApril = (): Map<string, Doc> =>
  new Map((JSON.parse(readFileSync(BASELINE, 'utf8')) as Doc[]).map(d => [d._id, d]))

export async function fetchSanityPeople(): Promise<Doc[]> {
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

export function neo4jDriver() {
  return neo4j.driver(
    process.env.NEO4J_URI!,
    neo4j.auth.basic(process.env.NEO4J_USERNAME!, process.env.NEO4J_PASSWORD!),
    { disableLosslessIntegers: true },
  )
}

export async function fetchGraphPeople(): Promise<Map<string, GraphPerson>> {
  const driver = neo4jDriver()
  const session = driver.session({ defaultAccessMode: neo4j.session.READ })
  try {
    const r = await session.run(`
      MATCH (p:Person) WHERE p.sanityId IS NOT NULL
      CALL {
        WITH p
        OPTIONAL MATCH (p)-[:REFERENCED_IN]->(s:Source)
        RETURN [u IN collect(s.url) WHERE u IS NOT NULL] AS links, collect(s.id) AS linkIds
      }
      CALL {
        WITH p
        OPTIONAL MATCH (p)-[:HAS_IMAGE]->(i:Source) WHERE i.url STARTS WITH 'https://cdn.sanity.io/'
        RETURN [u IN collect(i.url) | last(split(u, '/'))] AS images, collect(i.id) AS imageIds
      }
      CALL {
        WITH p
        OPTIONAL MATCH (p)-[k:RANK]->(rk:Rank)
        RETURN head(collect(CASE WHEN rk IS NULL THEN NULL ELSE {rankSlug: rk.slug, sourceRef: k.sourceRef} END)) AS knownRank
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
             p.birthYear AS birthYear, p.status AS status, p.status_sourceRef AS statusSourceRef,
             p.serviceClass AS serviceClass, p.serviceClass_sourceRef AS serviceClassSourceRef,
             [k IN keys(p) WHERE k ENDS WITH '_sha' OR k ENDS WITH '_graphSha' | [k, p[k]]] AS stampPairs,
             [k IN keys(p) WHERE k ENDS WITH '_sourceRef' AND p[k] = 'admin-edit' | k] AS adminRefs,
             links, linkIds, images, imageIds, knownRank, content, rels, graphOnlyRels
    `)
    return new Map(r.records.map(rec => {
      const { stampPairs, adminRefs, ...rest } = rec.toObject() as Omit<GraphPerson, 'stamps' | 'adminEdited'> & { stampPairs: [string, string][]; adminRefs: string[] }
      const adminEdited = adminRefs.map(k => k.slice(0, -'_sourceRef'.length)).map(k => k === 'canonicalName' ? 'name' : k)
      const g: GraphPerson = { ...rest, stamps: Object.fromEntries(stampPairs), adminEdited }
      return [g.sanityId, g]
    }))
  } finally {
    await session.close()
    await driver.close()
  }
}
