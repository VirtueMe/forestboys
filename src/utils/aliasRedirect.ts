/**
 * An address that is no page may be the old address of one that was renamed (#96). The server answers such a request with
 * a redirect (functions/_middleware.ts); this is the same for a reader who is already in the app, where a click on an old
 * link or a bookmark in the router never reaches the server.
 */
import { KIND_ROUTES, type QueryFn } from './slugResolver.ts'

const ROUTES = new Set(Object.values(KIND_ROUTES))

/** `/location/` is a second address of the pages `/map/` names. */
const SAME_AS: Record<string, string> = { '/location/': '/map/' }

/** The path the page has now, keeping the prefix the reader used and anything after the slug; null if `path` is no old address. */
export async function aliasRedirect(path: string, query: QueryFn): Promise<string | null> {
  const m = path.match(/^(\/[a-z]+\/)([^/]+)(\/.*)?$/)
  if (!m) return null
  const [, prefix, rawSlug, rest = ''] = m
  const route = SAME_AS[prefix] ?? prefix
  if (!ROUTES.has(route)) return null
  let slug = rawSlug
  try { slug = decodeURIComponent(rawSlug) } catch { /* keep the raw text */ }
  if (!slug || slug === 'new') return null
  const rows = await query(
    `MATCH (:SlugAlias {route: $route, slug: $slug})-[:ALIAS_OF]->(n) RETURN n.slug AS slug LIMIT 1`,
    { route, slug },
  )
  const target = rows[0]?.slug
  return typeof target === 'string' && target ? `${prefix}${encodeURIComponent(target)}${rest}` : null
}
