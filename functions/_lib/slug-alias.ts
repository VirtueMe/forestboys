/**
 * Slug aliases (#96): when a page is renamed, its old slug stays as
 *
 *   (:SlugAlias {route, slug, kind, createdAt})-[:ALIAS_OF]->(n)
 *
 * A node of its own and not a property, so entities and the Sanity sync diff stay clean. `route` is the address space
 * (`/events/` for Operation and Incident alike), so an alias and a live slug can never meet on the same address.
 * An alias points straight at the entity, never at another alias: renaming twice gives two aliases, no chain.
 * A slug is taken when a live node or an alias has it in that address space (`slugClaim`).
 */

import { runCypher, type Neo4jEnv } from './neo4j.ts'
import { KIND_ROUTES } from '../../src/utils/slugResolver.ts'

export const SLUG_RE = /^[a-z0-9-]+$/

/** The address space a kind of page lives in, or undefined for a kind with no route (it cannot be renamed). */
export const routeOf = (label: string): string | undefined => KIND_ROUTES[label]

/** Every label that shares `route` (Operation and Incident share `/events/`). */
export const labelsOnRoute = (route: string): string[] => Object.keys(KIND_ROUTES).filter(l => KIND_ROUTES[l] === route)

/** The aliases as slug rows for the link checker: `target` is the slug the alias now leads to. */
export const ALIAS_ROWS = `MATCH (a:SlugAlias)-[:ALIAS_OF]->(n) RETURN labels(n)[0] AS label, a.slug AS slug, n.slug AS target`

/** Where an old slug leads now, or null when `slug` is no alias on that route. */
export async function findAlias(env: Neo4jEnv, route: string, slug: string): Promise<{ label: string; slug: string } | null> {
  const [row] = await runCypher<{ label: string; slug: string }>(env, `
    MATCH (:SlugAlias {route: $route, slug: $slug})-[:ALIAS_OF]->(n)
    RETURN labels(n)[0] AS label, n.slug AS slug`, { route, slug }, 'Read')
  return row ?? null
}

/**
 * Who holds `slug` on `route`: a live node (`live`), an alias of some other entity (`alias`), or nobody (null).
 * An alias of `ownerSlug` itself does not count: an entity may take its old slug back.
 */
export async function slugClaim(env: Neo4jEnv, route: string, slug: string, ownerSlug?: string): Promise<'live' | 'alias' | null> {
  const labels = labelsOnRoute(route).map(l => `n:\`${l}\``).join(' OR ')
  const [live] = await runCypher<{ c: number }>(env, `MATCH (n) WHERE n.slug = $slug AND (${labels}) RETURN count(n) AS c`, { slug }, 'Read')
  if (Number(live?.c ?? 0) > 0) return 'live'
  const [alias] = await runCypher<{ c: number }>(env, `
    MATCH (a:SlugAlias {route: $route, slug: $slug})-[:ALIAS_OF]->(t)
    WHERE t.slug <> $owner
    RETURN count(a) AS c`, { route, slug, owner: ownerSlug ?? '' }, 'Read')
  return Number(alias?.c ?? 0) > 0 ? 'alias' : null
}
