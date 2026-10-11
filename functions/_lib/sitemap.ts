/**
 * The list of pages that exist (#220): one KV key, built from the graph, read both by `/sitemap.txt` and by the
 * middleware that answers 200 for a known entity page and 404 for an unknown one (`functions/_middleware.ts`).
 *
 * KV and not the Cache API: `caches.default` is per data centre, so a delete only clears the colo that handled the
 * write and the others would 404 a new page until the TTL ran out. A KV write is global within about a minute.
 *
 * The value is one canonical path per line (`/person/kåre` is stored as `/person/k%C3%A5re`), the metadata carries
 * `builtAt`. A line with a tab is not a page but an old address and where it leads now (`/events/old<TAB>/events/new`, #96):
 * the middleware answers it with a redirect instead of a 404, with no graph query. `/sitemap.txt` lists only the pages. A path is compared in its normalised form (`normalizePath`): decoded, lower case, no trailing slash.
 */

import { runCypher, type Neo4jEnv } from '~/_lib/neo4j.ts'
import { ALIAS_ROWS, routeOf } from '~/_lib/slug-alias.ts'

export interface SitemapBinding {
  SITEMAP?: KVNamespace
}

export type SitemapEnv = SitemapBinding & Partial<Neo4jEnv>

export const SITEMAP_KEY = 'sitemap'

/** Older than this, a read rebuilds the list in the background (catches writes that skip `invalidateSitemap`). */
export const MAX_AGE_MS = 24 * 60 * 60 * 1000

/** The page of each label that has a slug. Mirrors `KIND_ROUTES` in the app, plus Unit (`/district/`). */
export const ENTITY_ROUTES: Record<string, string> = {
  Person:        '/person/',
  Unit:          '/district/',
  Organization:  '/organization/',
  Operation:     '/events/',
  Incident:      '/events/',
  Station:       '/station/',
  Location:      '/map/',
  Transport:     '/transport/',
  EquipmentType: '/equipment/',
  Outline:       '/outlines/',
}

export const STATIC_ROUTES = [
  '/', '/people', '/events', '/stations', '/transport', '/outlines', '/registre', '/about', '/endringslogg',
]

/** Route prefixes that serve an entity page. `/location/` is a second address of `/map/`. */
const ENTITY_PREFIXES = ['person', 'district', 'organization', 'outlines', 'station', 'location', 'equipment', 'transport', 'events', 'map']
const PREFIX_ALIAS: Record<string, string> = { location: 'map' }

/** Slugs the editors use for the create form: never a page that can be missing. */
const EDITOR_SLUGS = new Set(['new'])

/** Decoded, lower case, no trailing slash: what a stored path and a requested path are both reduced to. */
export function normalizePath(path: string): string {
  let p = path.split(/[?#]/)[0]
  try { p = decodeURIComponent(p) } catch { /* keep the raw text */ }
  p = p.normalize('NFC').toLowerCase().replace(/\/{2,}/g, '/').replace(/\/+$/, '')
  return p || '/'
}

/**
 * `/person/kåre/medlemmer` → `/person/kåre`: the entity part of a request path, normalised, or null when the path
 * is not an entity route or is an editor-only one (`/person/new`).
 */
export function entityPath(path: string): string | null {
  const [, prefix, slug] = normalizePath(path).split('/')
  if (!prefix || !slug || !ENTITY_PREFIXES.includes(prefix) || EDITOR_SLUGS.has(slug)) return null
  return `/${PREFIX_ALIAS[prefix] ?? prefix}/${slug}`
}

/** The stored form of an entity page: the slug percent-encoded, as it appears in a URL. */
export function canonicalPath(prefix: string, slug: string): string {
  return prefix + encodeURIComponent(slug)
}

/** Every public entity slug, as canonical paths. */
async function entityPaths(env: Neo4jEnv): Promise<string[]> {
  const labels = Object.keys(ENTITY_ROUTES)
  const rows = await runCypher<{ labels: string[]; slug: string }>(
    env,
    `MATCH (n) WHERE n.slug IS NOT NULL AND any(l IN labels(n) WHERE l IN $labels)
     RETURN labels(n) AS labels, n.slug AS slug`,
    { labels },
    'Read',
  )
  const out: string[] = []
  for (const r of rows) {
    const label = r.labels.find(l => ENTITY_ROUTES[l])
    if (label && typeof r.slug === 'string' && r.slug && !EDITOR_SLUGS.has(r.slug)) out.push(canonicalPath(ENTITY_ROUTES[label], r.slug))
  }
  return out
}

/** Every old slug and the canonical path of the page it leads to now. */
async function aliasLines(env: Neo4jEnv): Promise<string[]> {
  const rows = await runCypher<{ label: string; slug: string; target: string }>(env, ALIAS_ROWS, {}, 'Read')
  const out: string[] = []
  for (const r of rows) {
    const route = routeOf(r.label)
    if (route && r.slug && r.target) out.push(`${canonicalPath(route, r.slug)}\t${canonicalPath(route, r.target)}`)
  }
  return out
}

/** Query the graph and store the list. Throws when the graph or the KV binding is unavailable. */
export async function buildSitemap(env: SitemapEnv): Promise<Sitemap> {
  if (!env.SITEMAP) throw new Error('SITEMAP KV binding missing')
  if (!env.NEO4J_URI || !env.NEO4J_USERNAME || !env.NEO4J_PASSWORD) throw new Error('Neo4j is not configured')
  const paths = [...new Set([...STATIC_ROUTES, ...await entityPaths(env as Neo4jEnv)])].sort()
  const aliases = (await aliasLines(env as Neo4jEnv)).sort()
  await env.SITEMAP.put(SITEMAP_KEY, [...paths, ...aliases].join('\n'), { metadata: { builtAt: Date.now() } })
  return parse([...paths, ...aliases].join('\n'))
}

/** Called by every write that changes the set of URLs; pass it to `waitUntil` so the response is not delayed. */
export async function invalidateSitemap(env: SitemapEnv): Promise<void> {
  try { await buildSitemap(env) } catch (e) { console.error('sitemap rebuild failed:', (e as Error).message) }
}

/** True when applying these bundle ops adds, removes or renames a page. */
export function opsChangeUrls(ops: { op: string; props?: object }[]): boolean {
  return ops.some(o => o.op === 'create-entity' || o.op === 'delete-entity' || (o.op === 'set-props' && !!o.props && 'slug' in o.props))
}

export interface Sitemap {
  /** Canonical paths of the pages, as stored. */
  paths: string[]
  /** The same, normalised, for lookups. */
  known: Set<string>
  /** Old address (normalised) → canonical path of the page it leads to now. */
  aliases: Map<string, string>
}

// An isolate keeps the parsed list for a minute: a 50 000-line split per request would be wasted work.
const LOCAL_TTL_MS = 60_000
let local: { at: number; value: string; sitemap: Sitemap } | null = null

/** Forget the list an isolate is holding (tests). */
export function clearSitemapCache(): void { local = null }

function parse(value: string): Sitemap {
  const paths: string[] = []
  const aliases = new Map<string, string>()
  for (const line of value.split('\n')) {
    if (!line) continue
    const [from, to] = line.split('\t')
    if (to !== undefined) aliases.set(normalizePath(from), to)
    else paths.push(line)
  }
  return { paths, known: new Set(paths.map(normalizePath)), aliases }
}

/**
 * The stored list, or null when there is none and it cannot be built (callers fail open on null). A missing key is
 * built on the spot; one older than `MAX_AGE_MS` is returned as it is and rebuilt through `waitUntil`.
 */
export async function readSitemap(env: SitemapEnv, waitUntil: (p: Promise<unknown>) => void): Promise<Sitemap | null> {
  if (!env.SITEMAP) return null
  if (local && Date.now() - local.at < LOCAL_TTL_MS) return local.sitemap
  try {
    const { value, metadata } = await env.SITEMAP.getWithMetadata<{ builtAt?: number }>(SITEMAP_KEY)
    if (value === null) return await buildSitemap(env)
    if (Date.now() - (metadata?.builtAt ?? 0) > MAX_AGE_MS) waitUntil(invalidateSitemap(env))
    const sitemap = local?.value === value ? local.sitemap : parse(value)
    local = { at: Date.now(), value, sitemap }
    return sitemap
  } catch (e) {
    console.error('sitemap read failed:', (e as Error).message)
    return null
  }
}

/** 404 only for an entity page the list does not know; 200 for everything else, and for any page when there is no list. */
export function pageStatus(path: string, sitemap: Sitemap | null): 200 | 404 {
  const entity = entityPath(path)
  if (!entity || !sitemap) return 200
  return sitemap.known.has(entity) ? 200 : 404
}

/**
 * Where an old address leads now, or null: `/person/old/medlemmer` → `/person/new/medlemmer`. The prefix the reader used is
 * kept (`/location/` stays `/location/`), and so is anything after the slug.
 */
export function redirectTarget(path: string, sitemap: Sitemap | null): string | null {
  const entity = entityPath(path)
  const to = entity && sitemap?.aliases.get(entity)
  if (!to) return null
  const [, typed, , ...rest] = path.split(/[?#]/)[0].split('/')
  const prefix = normalizePath('/' + typed).slice(1)
  const slug = to.split('/')[2]
  return `/${prefix}/${slug}${rest.length ? '/' + rest.join('/') : ''}`
}

/** The body of `/sitemap.txt`: one absolute URL per line. */
export function renderSitemap(paths: string[], origin: string): string {
  return paths.map(p => origin + p).join('\n') + '\n'
}
