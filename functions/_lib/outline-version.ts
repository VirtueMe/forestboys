/**
 * The version of an outline, what has been absorbed of it, and what an absorption of it produced (#157).
 *
 * An outline is Jan's text. The graph's entities made from it are bundles he accepts, and when the text
 * changes the next bundle has to be a new proposal. So the version of an outline is **a hash of its text**: the
 * blocks of its descriptions as a value, in `order`. It is the same before and after the day Jan stops editing in
 * Sanity, which Sanity's own `_rev` is not, and it names no Sanity id.
 *
 *   contentSha      the hash of the text as it is now
 *   absorbedSha     the hash of the text the last fully accepted bundle was made from (set when it archives the outline)
 *   state           new | bundled | absorbed | stale (derived, never stored)
 *
 * What an accepted bundle created carries `originOutline`, `originSha` and `originBundle` (bundle-origin.ts
 * `originStamp`), so «what did this outline produce» is `produced`, and what was produced from an older version
 * than the one it has now is marked.
 */

import { ENTITY_KINDS } from './bundle-validate.ts'
import { runCypher, type Neo4jEnv } from './neo4j.ts'
import { stableSha } from './stable-sha.ts'

export interface DescriptionRow { order: number | null; content: string | null }

const blocksOf = (content: string): unknown => { try { return JSON.parse(content) } catch { return content } }

/** The hash of an outline's text: its descriptions' blocks as a value, with their order, in order. */
export async function outlineContentSha(rows: DescriptionRow[]): Promise<string> {
  const text = rows
    .filter((r): r is { order: number | null; content: string } => typeof r.content === 'string')
    .map(r => ({ order: Number(r.order ?? 0), blocks: blocksOf(r.content) }))
    .sort((a, b) => a.order - b.order)
  return stableSha(text)
}

export type OutlineState = 'new' | 'bundled' | 'absorbed' | 'stale'

/**
 * Where an outline stands:
 *  - `bundled`  a bundle made from it is open (waiting for Jan);
 *  - `new`      nothing of it has been absorbed;
 *  - `absorbed` the text is what the last accepted bundle was made from;
 *  - `stale`    the text has changed since: a new bundle is what that calls for, and nothing changes until Jan accepts it.
 */
export function outlineState(v: { contentSha: string; absorbedSha: string | null; openBundles?: number }): OutlineState {
  if ((v.openBundles ?? 0) > 0) return 'bundled'
  if (!v.absorbedSha)           return 'new'
  return v.absorbedSha === v.contentSha ? 'absorbed' : 'stale'
}

export interface OutlineVersion {
  slug:         string
  contentSha:   string
  absorbedSha:  string | null
  absorbedBundle: string | null
  archivedAt:   string | null
  /** `bundled` needs the open bundles (R2), which this does not read: it is `new`, `absorbed` or `stale`. */
  state:        Exclude<OutlineState, 'bundled'>
}

/** The outline's version from the graph, or null when there is no such outline. */
export async function readOutlineVersion(env: Neo4jEnv, slug: string): Promise<OutlineVersion | null> {
  const rows = await runCypher<{ absorbedSha: string | null; absorbedBundle: string | null; archivedAt: string | null; descriptions: DescriptionRow[] }>(
    env,
    `MATCH (o:Outline {slug: $slug})
     OPTIONAL MATCH (o)-[:HAS_CONTENT]->(d:Description)
     RETURN o.absorbedSha AS absorbedSha, o.absorbedBundle AS absorbedBundle, o.archivedAt AS archivedAt,
            collect(CASE WHEN d IS NULL THEN null ELSE {order: d.order, content: d.content} END) AS descriptions`,
    { slug },
  )
  const row = rows[0]
  if (!row) return null
  const contentSha = await outlineContentSha(row.descriptions ?? [])
  const absorbedSha = row.absorbedSha ?? null
  return {
    slug, contentSha, absorbedSha,
    absorbedBundle: row.absorbedBundle ?? null,
    archivedAt:     row.archivedAt ?? null,
    state:          outlineState({ contentSha, absorbedSha }) as OutlineVersion['state'],
  }
}

/* ───────────────────────── what an outline produced ───────────────────────── */

export interface ProducedEntity { ref: string; originBundle: string | null; originSha: string | null; olderVersion: boolean }
export interface ProducedEdge   { type: string; from: string; to: string; originBundle: string | null; originSha: string | null; olderVersion: boolean }
export interface Produced       { entities: ProducedEntity[]; edges: ProducedEdge[] }

/** `<Kind>:<key>` from a node's labels and key: the first label that is a kind of entity. Null for any other node. */
export function entityRef(labels: string[], key: unknown): string | null {
  const kind = labels.find(l => ENTITY_KINDS.has(l))
  return kind && typeof key === 'string' && key ? `${kind}:${key}` : null
}

/**
 * Everything that carries this outline's origin: the nodes and edges its accepted bundles created, each marked when
 * it was made from an older version of the text than `contentSha`. This is what a new bundle for a changed outline
 * has to reckon with: what to keep, change or take away.
 */
export async function readProduced(env: Neo4jEnv, slug: string, contentSha: string): Promise<Produced> {
  const nodes = await runCypher<{ labels: string[]; key: unknown; sha: string | null; bundle: string | null }>(
    env,
    `MATCH (n) WHERE n.originOutline = $slug
     RETURN labels(n) AS labels, coalesce(n.slug, n.id) AS key, n.originSha AS sha, n.originBundle AS bundle`,
    { slug },
  )
  const edges = await runCypher<{ type: string; fromLabels: string[]; fromKey: unknown; toLabels: string[]; toKey: unknown; sha: string | null; bundle: string | null }>(
    env,
    `MATCH (a)-[r]->(b) WHERE r.originOutline = $slug
     RETURN type(r) AS type, labels(a) AS fromLabels, coalesce(a.slug, a.id) AS fromKey,
            labels(b) AS toLabels, coalesce(b.slug, b.id) AS toKey, r.originSha AS sha, r.originBundle AS bundle`,
    { slug },
  )
  const out: Produced = { entities: [], edges: [] }
  for (const n of nodes) {
    const ref = entityRef(n.labels, n.key)
    if (ref) out.entities.push({ ref, originBundle: n.bundle ?? null, originSha: n.sha ?? null, olderVersion: n.sha !== contentSha })
  }
  for (const e of edges) {
    const from = entityRef(e.fromLabels, e.fromKey)
    const to   = entityRef(e.toLabels, e.toKey)
    if (from && to) out.edges.push({ type: e.type, from, to, originBundle: e.bundle ?? null, originSha: e.sha ?? null, olderVersion: e.sha !== contentSha })
  }
  out.entities.sort((a, b) => a.ref.localeCompare(b.ref))
  out.edges.sort((a, b) => `${a.from}|${a.type}|${a.to}`.localeCompare(`${b.from}|${b.type}|${b.to}`))
  return out
}
