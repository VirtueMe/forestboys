/**
 * The save validator for links in descriptions.
 *
 * A save is judged by what it adds. A link that was already in the stored
 * description (same kind of link, same target) is left alone even when it is
 * bad, or Jan could not edit any of the ~240 legacy descriptions without
 * first fixing every link in them. A link that is new, or whose target was
 * changed, must lead somewhere:
 *
 *   broken, empty, ambiguous  → the save is refused (422), with the links
 *   fixable                   → saved, and listed as a warning with the page
 *                               it should name, so the editor can offer the fix
 *
 * Everything not refused, and still not ok, comes back as `warnings`.
 * The checking is src/utils/linkCheck.ts, shared with the admin list.
 */

import { runCypher, type Neo4jEnv } from './neo4j.ts'
import { buildIndex, checkLinks, linkSlugs, type LinkFinding, type LinkIssue, type SlugIndex } from '../../src/utils/linkCheck.ts'
import { KIND_ROUTES, slugKey, zeroVariants, type SlugRow } from '../../src/utils/slugResolver.ts'

export type LinkProblem = LinkIssue

const toProblem = ({ source, text, stored, verdict, suggestion, candidates }: LinkFinding): LinkProblem =>
  ({ source, text, stored, verdict, ...(suggestion && { suggestion }), ...(candidates && { candidates }) })

const REFUSED = new Set<LinkFinding['verdict']>(['broken', 'empty', 'ambiguous'])
const identity = (l: { source: string; stored: string }) => `${l.source}|${l.stored.trim()}`

/** Pure: judge the new descriptions against the ones they replace. */
export function judgeLinks(previous: unknown[], next: unknown[], index: SlugIndex): { blocked: LinkProblem[]; warnings: LinkProblem[] } {
  const had = new Set(previous.flatMap(c => checkLinks(c, index)).map(identity))
  const blocked: LinkProblem[] = []
  const warnings: LinkProblem[] = []
  for (const f of next.flatMap(c => checkLinks(c, index))) {
    if (f.verdict === 'ok') continue
    if (REFUSED.has(f.verdict) && !had.has(identity(f))) blocked.push(toProblem(f))
    else warnings.push(toProblem(f))
  }
  return { blocked, warnings }
}

const KINDS = Object.keys(KIND_ROUTES).map(l => `n:${l}`).join(' OR ')
const FLAT = "toLower(replace(replace(replace(replace(replace(n.slug, '-', ''), ' ', ''), '_', ''), '.', ''), '/', ''))"

/** The pages these slugs could mean: a superset, `matchSlug` picks the right one. */
async function slugRows(env: Neo4jEnv, slugs: string[]): Promise<SlugRow[]> {
  const exacts = [...new Set(slugs.map(s => s.trim()).filter(Boolean))]
  if (!exacts.length) return []
  const keys = [...new Set(exacts.flatMap(s => { const k = slugKey(s); return k ? zeroVariants(k) : [] }))]
  return runCypher<SlugRow>(env, `
    MATCH (n) WHERE n.slug IS NOT NULL AND (${KINDS}) AND (n.slug IN $exacts OR ${FLAT} IN $keys)
    RETURN labels(n)[0] AS label, n.slug AS slug
  `, { exacts, keys }, 'Read')
}

/** The node a description belongs to: its label(s) and the property that names it. */
export interface Owner { labels: string[]; keyProp?: 'slug' | 'key'; key: string }

const IDENT = /^[A-Za-z]+$/

export async function storedContents(env: Neo4jEnv, o: Owner): Promise<string[]> {
  const prop = o.keyProp ?? 'slug'
  if (!o.labels.every(l => IDENT.test(l)) || !IDENT.test(prop)) throw new Error('bad owner')
  const any = o.labels.map(l => `n:\`${l}\``).join(' OR ')
  const rows = await runCypher<{ content: string | null }>(env, `
    MATCH (n) WHERE (${any}) AND n.${prop} = $key
    MATCH (n)-[:HAS_CONTENT]->(d:Description)
    RETURN d.content AS content
  `, { key: o.key }, 'Read')
  return rows.map(r => r.content ?? '')
}

export type GuardResult =
  | { blocked: Response; warnings?: undefined }
  | { blocked: null; warnings: LinkProblem[] }

/**
 * Judge the contents about to be saved on `owner`. `blocked` is a ready 422
 * response to return as it is; otherwise save, and hand `warnings` back.
 */
export async function guardSections(env: Neo4jEnv, owner: Owner, contents: string[]): Promise<GuardResult> {
  return guardContents(env, await storedContents(env, owner), contents)
}

/** Same, when the caller already has the stored contents. */
export async function guardContents(env: Neo4jEnv, previous: string[], contents: string[]): Promise<GuardResult> {
  const { blocked, warnings } = await judgeStored(env, previous, contents)
  if (!blocked.length) return { blocked: null, warnings }
  return {
    blocked: new Response(JSON.stringify({
      error: 'Noen lenker peker ikke til en side som finnes. Rett dem, eller fjern lenken, og lagre på nytt.',
      links: blocked,
    }), { status: 422, headers: { 'Content-Type': 'application/json' } }),
  }
}

/** The judgement without a response, for callers that report in their own way. */
export async function judgeStored(env: Neo4jEnv, previous: string[], contents: string[]) {
  const rows = await slugRows(env, [...previous, ...contents].flatMap(linkSlugs))
  return judgeLinks(previous, contents, buildIndex(rows))
}
