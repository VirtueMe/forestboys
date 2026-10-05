/**
 * Does a link in a description lead anywhere?
 *
 * Reads the Portable Text of one description and gives every internal link a
 * verdict, using the same rules the page uses when it opens the link
 * (`resolveLinkTarget`) and the same matching as `resolveSlug`. Pure: the
 * caller supplies an index of the slugs that exist, so the admin list (all
 * slugs, once) and the save validator (a few) use the one function.
 *
 * - ok         the page exists, with exactly that slug and kind
 * - fixable    one page is meant, but the stored link names it differently
 *              (spelling, another kind, an old slug that was renamed)
 * - ambiguous  more than one page fits equally well
 * - broken     no page fits
 * - empty      the link has no target
 *
 * External and mail links are not checked and do not appear.
 */

import { resolveLinkTarget, type SanityBlock } from './portableText.ts'
import { KIND_ROUTES, matchSlug, slugKey, type SlugHit, type SlugRow } from './slugResolver.ts'

export type Verdict = 'ok' | 'fixable' | 'ambiguous' | 'broken' | 'empty'

export interface LinkFinding {
  blockKey:    string
  markKey:     string
  /** A `link` mark (a stored target) or a `person` mark (a stored slug). */
  source:      'link' | 'person'
  /** The words that are the link. */
  text:        string
  /** What is stored: the target as typed, or the person's slug. */
  stored:      string
  verdict:     Verdict
  /** Where it should lead, for `fixable`. */
  suggestion?: SlugHit
  /** The pages that fit equally well, for `ambiguous`. */
  candidates?: SlugHit[]
}

/** What an editor needs of a finding: which link, what is wrong, and what could replace it. */
export type LinkIssue = Pick<LinkFinding, 'source' | 'text' | 'stored' | 'verdict' | 'suggestion' | 'candidates'>

/** The slugs that exist, looked up by the way a link might spell one. */
export interface SlugIndex { rows(slug: string): SlugRow[] }

export function buildIndex(rows: SlugRow[]): SlugIndex {
  const byKey = new Map<string, SlugRow[]>()
  for (const r of rows) {
    const k = slugKey(r.slug)
    if (!k) continue
    const list = byKey.get(k)
    if (list) list.push(r)
    else byKey.set(k, [r])
  }
  return { rows: slug => byKey.get(slugKey(slug)) ?? [] }
}

const ROUTES = new Set(Object.values(KIND_ROUTES))

/** `/person/x` → { route: '/person/', slug: 'x' }; null for a path that is no page of ours. */
function parsePath(href: string): { route: string; slug: string } | null {
  const m = href.match(/^(\/[a-z]+\/)(.+)$/)
  if (!m || !ROUTES.has(m[1])) return null
  try { return { route: m[1], slug: decodeURIComponent(m[2]) } } catch { return { route: m[1], slug: m[2] } }
}

/** Kinds that share a route (Operation and Incident) are one kind of target. */
const sameRoute = (label: string, route: string) => KIND_ROUTES[label] === route

function verdictFor(route: string, slug: string, index: SlugIndex): Pick<LinkFinding, 'verdict' | 'suggestion' | 'candidates'> {
  const rows = index.rows(slug)
  // The kind the link names comes first; a page of another kind is only a suggestion.
  let m = matchSlug(rows.filter(r => sameRoute(r.label, route)), slug)
  if (m.kind === 'none') m = matchSlug(rows, slug)
  if (m.kind === 'ambiguous') return { verdict: 'ambiguous', candidates: m.candidates }
  if (m.kind === 'none') return { verdict: 'broken' }
  const same = sameRoute(m.hit.label, route) && m.hit.slug === slug.trim()
  return same ? { verdict: 'ok' } : { verdict: 'fixable', suggestion: m.hit }
}

function parse(content: unknown): SanityBlock[] {
  if (typeof content === 'string') {
    try { content = JSON.parse(content) } catch { return [] }
  }
  return Array.isArray(content) ? content as SanityBlock[] : []
}

interface Link {
  blockKey: string
  markKey:  string
  source:   'link' | 'person'
  text:     string
  stored:   string
  /** What it points at: a page, nothing (`empty`), or something not ours to check (`null`). */
  target:   { route: string; slug: string } | 'empty' | null
}

/** Every link mark in `content` that some text uses, with what it points at. */
function* links(content: unknown): Generator<Link> {
  for (const block of parse(content)) {
    if (block?._type !== 'block') continue
    for (const def of block.markDefs ?? []) {
      const source = def._type === 'link' ? 'link' : def._type === 'person' ? 'person' : null
      if (!source) continue
      const text = (block.children ?? []).filter(c => c.marks?.includes(def._key)).map(c => c.text ?? '').join('')
      if (!text) continue                       // the mark is not used: nothing shows

      const stored = source === 'link' ? (def.href ?? '') : (def.slug ?? '')
      const base: Omit<Link, 'target'> = { blockKey: block._key, markKey: def._key, source, text, stored }
      if (source === 'person') {
        yield { ...base, target: stored.trim() ? { route: KIND_ROUTES.Person, slug: stored } : 'empty' }
        continue
      }
      const resolved = resolveLinkTarget(stored)
      if (!resolved) yield { ...base, target: 'empty' }
      else yield { ...base, target: resolved.kind === 'internal' ? parsePath(resolved.href) : null }
    }
  }
}

/** The slugs a caller has to look up before `checkLinks` can judge `content`. */
export function linkSlugs(content: unknown): string[] {
  const out: string[] = []
  for (const l of links(content)) if (l.target && l.target !== 'empty') out.push(l.target.slug)
  return out
}

/** Every internal link and person link in `content` (Portable Text, or its JSON string) with a verdict. */
export function checkLinks(content: unknown, index: SlugIndex): LinkFinding[] {
  const out: LinkFinding[] = []
  for (const { target, ...l } of links(content)) {
    if (target === 'empty') out.push({ ...l, verdict: 'empty' })
    else if (target) out.push({ ...l, ...verdictFor(target.route, target.slug, index) })
  }
  return out
}

/** The findings that need a person's attention. */
export const problems = (findings: LinkFinding[]) => findings.filter(f => f.verdict !== 'ok')
