/**
 * Apply / unwind helpers shared by accept.ts + deny.ts.
 *
 * Responsibilities:
 *   - Drift check for `modify-block` ops (recompute live sha vs `expectedSha`),
 *     `set-props` ops (live value vs the op's `from`) and `set-description` ops
 *     (sha of the live description vs the op's `expectedSha`).
 *   - Translate a payload's ops into Neo4j writes (per-entity transaction).
 *   - R2 conditional-write helpers (intent lock, manifest patch, index patch).
 *
 * v1 limitations (callouts where a follow-up is needed):
 *   - `modify-block` apply uses read-then-write across two Cypher calls
 *     because surgery on `Description.content` (a JSON-stringified PT array)
 *     in pure Cypher is awkward. Single-writer admin makes the race window
 *     small, but the spec calls for per-entity atomicity — a follow-up
 *     should fold the read+update into one APOC-assisted statement.
 *   - Edge-target resolution against not-yet-applied bundle entities is
 *     not implemented: `add-edge`/`remove-edge` MATCH live nodes only and
 *     fail loudly if a target is missing. The accept order on Jan's side
 *     (parents before children) is what makes this work in practice.
 *   - Description-node lookup keys on the section slug being equal to the
 *     `Description.slug` property (or an `id` containing it). The exact
 *     mapping needs a quick spike against live data — see TODO in
 *     `applyModifyBlock`.
 */

import { runCypher, runCypherTx, type Neo4jEnv } from '~/_lib/neo4j.ts'
import { stableSha } from '~/_lib/stable-sha.ts'
import { originStamp, sourceIndexKey, type BundleOriginFields, type DerivedFrom } from '~/_lib/bundle-origin.ts'
import { bundleCounts } from '../../../../src/utils/bundleStatus.ts'
import { ENTITY_ID_RE, keyProp, nodePattern, parseNodeRef } from '~/_lib/entity-ref.ts'
import { DEMOTE_TO_INCIDENT, PROMOTE_TO_OPERATION } from '~/_lib/event-kind.ts'
import { judgeStored, storedContents, type LinkProblem } from '~/_lib/link-guard.ts'

export { ENTITY_ID_RE }
export const BLOCK_PATH_RE = /^section\.([a-z0-9-]+)\.block\.([A-Za-z0-9_-]+)$/

export type BundleOp =
  | { op: 'create-entity'; kind: string; slug: string; props: Record<string, unknown>; edges?: { type: string; to: string; props?: Record<string, unknown> }[]; descriptions?: { order: number; content: string }[] }
  | { op: 'modify-block'; blockPath: string; expectedSha: string; newValue: PtBlock }
  | { op: 'add-edge';     type: string; from: string; to: string; props?: Record<string, unknown> }
  | { op: 'remove-edge';  type: string; from: string; to: string }
  /** The whole text of one Description of the entity, replaced (or created when `expectedSha` is empty): #161. */
  | { op: 'set-description'; order: number; expectedSha: string; content: string }
  | { op: 'delete-entity' }
  | { op: 'obsolete-outline'; reason: string }
  /** Scalar properties on the payload's entity; `to: null` removes it. `from` is the value the proposal expects to replace. */
  | { op: 'set-props';    props: Record<string, { from: unknown; to: unknown }> }
  /** Operation ↔ Incident (functions/_lib/event-kind.ts). Demotion drops ORCHESTRATED_BY and unit participation. */
  | { op: 'set-kind';     to: 'Operation' | 'Incident' }

export interface EntityPayload {
  entityId:    string
  ops:         BundleOp[]
  derivedFrom: DerivedFrom
  source:      string
  generatedAt: string
}

export interface BundleManifest extends BundleOriginFields {
  bundleId:    string
  summary:     string
  createdAt:   string
  model:       string
  promptHash:  string
  entities:    { entityId: string; status: 'pending' | 'accepted' | 'denied' | 'drifted'; opSummary: string[]; refusal?: DriftedProp[] }[]
  /** Written by ingest as 'blocked' only; the status the reviewer sees is derived (src/utils/bundleStatus.ts, #185). */
  status?:          'pending' | 'blocked' | 'closed'
  unresolvedRefs?:  string[]
  parentBundle?:    string
  resolvesEntities?: string[]
}

export interface IndexFile { bundleIds: string[] }

/**
 * Minimal Portable Text block shape — we only commit to the fields we
 * actually traverse (`_type`, `_key`). Per-span content (`children`,
 * `markDefs`) is opaque to the proposal pipeline; full PT typing lives
 * in `src/utils/portableText.ts`.
 */
export interface PtBlock {
  _type:    'block'
  _key:     string
  children: unknown[]
  [k: string]: unknown
}

export interface DriftedProp {
  prop:     string
  expected: unknown
  actual:   unknown
}

const norm = (v: unknown) => JSON.stringify(v ?? null)

/**
 * Archive an outline once a bundle made from it is fully accepted, and record what was absorbed: the hash of the
 * text the bundle was made from (`absorbedSha`, the bundle's `outlineRev`) and the bundle. An outline whose text
 * has changed since is stale (functions/_lib/outline-version.ts); nothing here is stored as a state.
 */
export function archiveOutlineStatement(a: { slug: string; at: string; reason: string; sha?: string; bundleId: string }): { statement: string; parameters: Record<string, unknown> } {
  return {
    statement: `MATCH (o:Outline {slug: $slug})
                SET o.archivedAt = $at, o.archivedReason = $reason, o.absorbedSha = $sha, o.absorbedBundle = $bundle`,
    parameters: { slug: a.slug, at: a.at, reason: a.reason, sha: a.sha ?? null, bundle: a.bundleId },
  }
}

/** Compare each set-props op's `from` against the live node. */
export async function checkPropDrift(env: Neo4jEnv, entityId: string, ops: BundleOp[]): Promise<DriftedProp[]> {
  const setOps = ops.filter((o): o is Extract<BundleOp, { op: 'set-props' }> => o.op === 'set-props')
  if (!setOps.length) return []
  const idMatch = entityId.match(ENTITY_ID_RE)
  if (!idMatch) return []
  const [, kind, slug] = idMatch
  const [row] = await runCypher<{ props: Record<string, unknown> | null }>(
    env, `OPTIONAL MATCH ${nodePattern('n', kind, 'slug')} RETURN properties(n) AS props`, { slug })
  const live = row?.props ?? {}
  const drifted: DriftedProp[] = []
  for (const op of setOps) {
    for (const [prop, { from }] of Object.entries(op.props)) {
      if (norm(live[prop]) !== norm(from)) drifted.push({ prop, expected: from ?? null, actual: live[prop] ?? null })
    }
  }
  return drifted
}

/**
 * A `create-entity` for an entity the graph already holds is refused: the apply would `CREATE` a second node. Reported
 * like a drifted property (`prop` «entity»), so the review shows it the same way and the entity is set aside, not applied.
 * This is what makes the order of the conversion of earlier absorptions safe (#158): a bundle that creates what we made
 * from an outline cannot be accepted before those nodes are removed.
 */
export async function checkEntityExists(env: Neo4jEnv, entityId: string, ops: BundleOp[]): Promise<DriftedProp[]> {
  if (!ops.some(o => o.op === 'create-entity')) return []
  const idMatch = entityId.match(ENTITY_ID_RE)
  if (!idMatch) return []
  const [, kind, slug] = idMatch
  const rows = await runCypher<{ n: number }>(env, `MATCH ${nodePattern('n', kind, 'slug')} RETURN count(n) AS n`, { slug })
  return Number(rows[0]?.n ?? 0) > 0 ? [{ prop: 'entity', expected: null, actual: 'exists' }] : []
}

/**
 * Compare each set-description op's `expectedSha` with the sha of the live description of that order
 * (the stableSha of its parsed blocks; empty when there is none). Reported like a drifted property, so the
 * review shows it the same way: `prop` is «description <order>», `expected` and `actual` are the shas.
 */
export async function checkDescriptionDrift(env: Neo4jEnv, entityId: string, ops: BundleOp[]): Promise<DriftedProp[]> {
  const setOps = ops.filter((o): o is Extract<BundleOp, { op: 'set-description' }> => o.op === 'set-description')
  if (!setOps.length) return []
  const idMatch = entityId.match(ENTITY_ID_RE)
  if (!idMatch) return []
  const [, kind, slug] = idMatch
  const rows = await runCypher<{ order: number; content: string | null }>(
    env,
    `MATCH ${nodePattern('e', kind, 'slug')}-[:HAS_CONTENT]->(d:Description)
     RETURN d.order AS order, d.content AS content`,
    { slug },
  )
  const drifted: DriftedProp[] = []
  for (const op of setOps) {
    const live = rows.find(r => Number(r.order) === op.order)
    const actual = live?.content ? await descriptionSha(live.content) : ''
    if (actual !== op.expectedSha) drifted.push({ prop: `description ${op.order}`, expected: op.expectedSha, actual })
  }
  return drifted
}

/** The sha of a description: of its blocks as a value, so another way of writing the same JSON is not a change. */
async function descriptionSha(content: string): Promise<string> {
  try { return await stableSha(JSON.parse(content)) } catch { return await stableSha(content) }
}

export interface DriftedBlock {
  blockPath:    string
  expectedSha:  string
  actualSha:    string
  currentValue: PtBlock | null
}

/** Compare the user-supplied expectedShas against live block content. */
export async function checkDrift(
  env:           Neo4jEnv,
  entityId:      string,
  ops:           BundleOp[],
  expectedShas:  Record<string, string>,
): Promise<DriftedBlock[]> {
  const drifted: DriftedBlock[] = []
  for (const op of ops) {
    if (op.op !== 'modify-block') continue
    const expected = expectedShas[op.blockPath]
    if (typeof expected !== 'string') {
      drifted.push({ blockPath: op.blockPath, expectedSha: '', actualSha: '<missing-from-request>', currentValue: null })
      continue
    }
    const live = await readLiveBlock(env, entityId, op.blockPath)
    const actualSha = live === null ? '' : await stableSha(live)
    if (actualSha !== expected) {
      drifted.push({ blockPath: op.blockPath, expectedSha: expected, actualSha, currentValue: live })
    }
  }
  return drifted
}

/** Read the live PT block addressed by blockPath, or null if absent. */
export async function readLiveBlock(
  env:       Neo4jEnv,
  entityId:  string,
  blockPath: string,
): Promise<PtBlock | null> {
  const idMatch = entityId.match(ENTITY_ID_RE)
  const pMatch  = blockPath.match(BLOCK_PATH_RE)
  if (!idMatch || !pMatch) return null
  const [, kind, slug]      = idMatch
  const [, sectionSlug, key] = pMatch

  // TODO: the section→Description mapping is approximate. Spec says
  // Description.id is `desc:<kind>:<slug>:<order>`; section identity
  // (heading slug → Description) needs validation against live data.
  // For v1, walk every Description on the entity and find the block by
  // _key — section slug is informational.
  void sectionSlug

  const rows = await runCypher<{ content: string | null }>(
    env,
    `MATCH ${nodePattern('e', kind, 'slug')}-[:HAS_CONTENT]->(d:Description)
     RETURN d.content AS content`,
    { slug },
  )

  for (const row of rows) {
    if (!row.content) continue
    try {
      const blocks = JSON.parse(row.content) as PtBlock[]
      const found  = blocks.find((b) => b?._key === key)
      if (found) return found
    } catch {
      // malformed content, skip
    }
  }
  return null
}

/**
 * New links in the descriptions this entity's ops write that lead nowhere
 * (functions/_lib/link-guard.ts). Checked on accept, before anything is
 * applied, like drift. A link already in the stored description is left alone.
 */
export async function checkOpLinks(env: Neo4jEnv, entityId: string, ops: BundleOp[]): Promise<LinkProblem[]> {
  const written: string[] = []
  for (const op of ops) {
    if (op.op === 'modify-block') written.push(JSON.stringify([op.newValue]))
    else if (op.op === 'create-entity') for (const d of op.descriptions ?? []) written.push(d.content)
    else if (op.op === 'set-description') written.push(op.content)
  }
  if (!written.length) return []
  const idMatch = entityId.match(ENTITY_ID_RE)
  if (!idMatch) return []
  const previous = await storedContents(env, { labels: [idMatch[1]], key: idMatch[2] })
  return (await judgeStored(env, previous, written)).blocked
}

/**
 * Apply every op for one entity. Best-effort per-entity atomicity:
 * non-modify-block ops batch into one Cypher transaction; each
 * modify-block runs as its own read-then-write (see v1 limitation note
 * at top of file).
 *
 * Returns a summary suitable for the history-log entry.
 */
export interface ApplySummary {
  appliedOps:    string[]
  droppedEdges:  { type: string; from: string; to: string; reason: string }[]
}

export async function applyEntityOps(
  env:        Neo4jEnv,
  entityId:   string,
  payload:    EntityPayload,
  bundleId:   string,
  acceptedAt: string,
): Promise<ApplySummary> {
  const idMatch = entityId.match(ENTITY_ID_RE)
  if (!idMatch) throw new Error(`entityId malformed: ${entityId}`)
  const [, kind, slug] = idMatch

  const summary: ApplySummary = { appliedOps: [], droppedEdges: [] }
  // Written on what this bundle creates, in the same transaction (docs/BUNDLE-FORMAT.md, #157).
  const stamp = originStamp(payload.derivedFrom, bundleId)
  const txStatements: { statement: string; parameters?: Record<string, unknown> }[] = []

  for (const op of payload.ops) {
    switch (op.op) {
      case 'create-entity': {
        // Strip the descriptions field if Claude leaked it into props
        // (older malformed bundles) so it doesn't land as a node prop.
        const { descriptions: _drop, ...sanitizedProps } = op.props
        void _drop
        // A Source is keyed by `id`, every other kind by `slug` (entity-ref.ts `keyProp`).
        const key = keyProp(op.kind)
        txStatements.push({
          statement: `CREATE (n:\`${op.kind}\`) SET n = $props, n.${key} = $slug`,
          parameters: { props: { ...sanitizedProps, ...stamp, [key]: op.slug }, slug: op.slug },
        })
        if (op.descriptions?.length) {
          for (const d of op.descriptions) {
            const descId = `desc:${op.kind}:${op.slug}:${d.order}`
            txStatements.push({
              statement:
                `MATCH ${nodePattern('n', op.kind, 'slug')}
                 CREATE (n)-[:HAS_CONTENT]->(:Description { id: $id, order: $order, content: $content })`,
              parameters: { slug: op.slug, id: descId, order: d.order, content: d.content },
            })
          }
        }
        if (op.edges) {
          for (const edge of op.edges) {
            const to = parseNodeRef(edge.to)
            if (!to) {
              summary.droppedEdges.push({ type: edge.type, from: entityId, to: edge.to, reason: 'malformed target id' })
              continue
            }
            txStatements.push({
              statement:
                `MATCH ${nodePattern('a', op.kind, 'fromSlug')}, ${nodePattern('b', to.kind, 'toKey')}
                 CREATE (a)-[r:\`${edge.type}\`]->(b) SET r = $props`,
              parameters: { fromSlug: op.slug, toKey: to.key, props: { ...edge.props, ...stamp } },
            })
          }
        }
        summary.appliedOps.push(`create ${entityId}${op.descriptions?.length ? ` (+${op.descriptions.length} descriptions)` : ''}`)
        break
      }
      case 'add-edge': {
        const from = parseNodeRef(op.from)
        const to   = parseNodeRef(op.to)
        if (!from || !to) throw new Error(`add-edge: malformed from/to (${op.from}, ${op.to})`)
        txStatements.push({
          statement:
            `MATCH ${nodePattern('a', from.kind, 'fromKey')}, ${nodePattern('b', to.kind, 'toKey')}
             MERGE (a)-[r:\`${op.type}\`]->(b)
             ON CREATE SET r += $stamp
             SET r += $props`,
          // The stamp only goes on an edge this op creates: an edge that was there is not this bundle's.
          parameters: { fromKey: from.key, toKey: to.key, props: op.props ?? {}, stamp },
        })
        summary.appliedOps.push(`+${op.type} ${op.from} → ${op.to}`)
        break
      }
      case 'remove-edge': {
        const from = parseNodeRef(op.from)
        const to   = parseNodeRef(op.to)
        if (!from || !to) throw new Error(`remove-edge: malformed from/to (${op.from}, ${op.to})`)
        txStatements.push({
          statement:
            `MATCH ${nodePattern('a', from.kind, 'fromKey')}-[r:\`${op.type}\`]->${nodePattern('b', to.kind, 'toKey')}
             DELETE r`,
          parameters: { fromKey: from.key, toKey: to.key },
        })
        summary.appliedOps.push(`-${op.type} ${op.from} → ${op.to}`)
        break
      }
      case 'delete-entity': {
        txStatements.push({
          statement: `MATCH ${nodePattern('n', kind, 'slug')} DETACH DELETE n`,
          parameters: { slug },
        })
        summary.appliedOps.push(`delete ${entityId}`)
        break
      }
      case 'obsolete-outline': {
        txStatements.push(archiveOutlineStatement({
          slug, at: acceptedAt, reason: op.reason, bundleId,
          sha: 'outlineRev' in payload.derivedFrom ? payload.derivedFrom.outlineRev : undefined,
        }))
        summary.appliedOps.push(`archive ${entityId}`)
        break
      }
      case 'set-props': {
        const set = Object.fromEntries(Object.entries(op.props).map(([k, v]) => [k, v.to ?? null]))
        txStatements.push({
          // A null in `SET n += map` removes that property.
          statement: `MATCH ${nodePattern('n', kind, 'slug')} SET n += $set`,
          parameters: { slug, set },
        })
        summary.appliedOps.push(`set ${Object.keys(set).join(', ')} on ${entityId}`)
        break
      }
      case 'modify-block':
      case 'set-description':
      case 'set-kind':
        // Handled below — modify-block and set-description per op; set-kind last, as it relabels the entity.
        break
    }
  }

  const setKind = payload.ops.find((o): o is Extract<BundleOp, { op: 'set-kind' }> => o.op === 'set-kind')
  if (setKind && kind !== 'Operation' && kind !== 'Incident') throw new Error(`set-kind: ${entityId} is not an Operation/Incident`)

  // Run the batched non-modify-block ops as one transaction.
  if (txStatements.length) {
    await runCypherTx(env, txStatements)
  }

  // Apply modify-block ops (read-modify-write).
  for (const op of payload.ops) {
    if (op.op !== 'modify-block') continue
    await applyModifyBlock(env, kind, slug, op, bundleId, acceptedAt)
    summary.appliedOps.push(`modify ${op.blockPath}`)
  }

  // Replace (or create) whole descriptions: read-then-write like modify-block, to stamp what was there.
  for (const op of payload.ops) {
    if (op.op !== 'set-description') continue
    await applySetDescription(env, kind, slug, op, bundleId, acceptedAt)
    summary.appliedOps.push(`description ${op.order} on ${entityId}`)
  }

  // Relabel last — every op above matches the entity by its current label.
  if (setKind && setKind.to !== kind) {
    await runCypherTx(env, [{
      statement:  setKind.to === 'Incident' ? DEMOTE_TO_INCIDENT : PROMOTE_TO_OPERATION,
      parameters: { slugs: [slug] },
    }])
    summary.appliedOps.push(`kind ${kind} → ${setKind.to}`)
  }

  return summary
}

/**
 * Replace the whole content of the entity's Description with this `order`, or create it when there is none.
 * A replaced description keeps what was there, as every write does (docs/PROPOSALS.md, *Single-step revert*):
 * `previousValue` is the **whole content** (a JSON string of blocks) and `previousKind` says so, where a
 * modify-block keeps the one block it replaced (`previousKind: 'block'`).
 */
async function applySetDescription(
  env:        Neo4jEnv,
  kind:       string,
  slug:       string,
  op:         Extract<BundleOp, { op: 'set-description' }>,
  bundleId:   string,
  acceptedAt: string,
): Promise<void> {
  const rows = await runCypher<{ descId: string; content: string | null }>(
    env,
    `MATCH ${nodePattern('e', kind, 'slug')}-[:HAS_CONTENT]->(d:Description {order: $order})
     RETURN d.id AS descId, d.content AS content`,
    { slug, order: op.order },
  )
  const there = rows[0]
  if (!there) {
    await runCypher(
      env,
      `MATCH ${nodePattern('e', kind, 'slug')}
       CREATE (e)-[:HAS_CONTENT]->(:Description { id: $id, order: $order, content: $content })`,
      { slug, id: `desc:${kind}:${slug}:${op.order}`, order: op.order, content: op.content },
    )
    return
  }
  await runCypher(
    env,
    `MATCH (d:Description {id: $descId})
     SET d.content        = $content,
         d.previousValue  = $previousValue,
         d.previousSha    = $previousSha,
         d.previousAt     = $previousAt,
         d.previousSource = $previousSource,
         d.previousKind   = 'description'`,
    {
      descId:         there.descId,
      content:        op.content,
      previousValue:  there.content ?? '',
      previousSha:    there.content ? await descriptionSha(there.content) : '',
      previousAt:     acceptedAt,
      previousSource: `proposal:${bundleId}`,
    },
  )
}

async function applyModifyBlock(
  env:        Neo4jEnv,
  kind:       string,
  slug:       string,
  op:         Extract<BundleOp, { op: 'modify-block' }>,
  bundleId:   string,
  acceptedAt: string,
): Promise<void> {
  const pMatch = op.blockPath.match(BLOCK_PATH_RE)
  if (!pMatch) throw new Error(`modify-block: malformed blockPath ${op.blockPath}`)
  const [, , key] = pMatch

  // Find the Description holding the block keyed by $key.
  const rows = await runCypher<{ descId: string; content: string }>(
    env,
    `MATCH ${nodePattern('e', kind, 'slug')}-[:HAS_CONTENT]->(d:Description)
     RETURN d.id AS descId, d.content AS content`,
    { slug },
  )

  let target: { descId: string; blocks: PtBlock[]; idx: number } | null = null
  for (const row of rows) {
    if (!row.content) continue
    try {
      const blocks = JSON.parse(row.content) as PtBlock[]
      const idx    = blocks.findIndex((b) => b?._key === key)
      if (idx !== -1) {
        target = { descId: row.descId, blocks, idx }
        break
      }
    } catch { /* skip malformed */ }
  }
  if (!target) {
    throw new Error(`modify-block: no Description on ${kind}:${slug} contains a block with _key="${key}"`)
  }

  const oldBlock     = target.blocks[target.idx]
  const newBlock     = op.newValue
  const previousJson = JSON.stringify(oldBlock)
  const previousSha  = await stableSha(oldBlock)

  target.blocks[target.idx] = newBlock
  const newContent = JSON.stringify(target.blocks)

  await runCypher(
    env,
    `MATCH (d:Description {id: $descId})
     SET d.content        = $content,
         d.previousValue  = $previousValue,
         d.previousSha    = $previousSha,
         d.previousAt     = $previousAt,
         d.previousSource = $previousSource,
         d.previousKind   = 'block'`,
    {
      descId:         target.descId,
      content:        newContent,
      previousValue:  previousJson,
      previousSha,
      previousAt:     acceptedAt,
      previousSource: `proposal:${bundleId}`,
    },
  )
}

/* ────────────────────────── R2 helpers ────────────────────────── */

interface R2Like {
  PROPOSALS: R2Bucket
}

/** PUT with `If-None-Match: *` — fail if key exists (intent-lock semantics). */
export async function putIntentLock(
  bucket: R2Bucket,
  key:    string,
  body:   string,
): Promise<boolean> {
  const result = await bucket.put(key, body, {
    httpMetadata: { contentType: 'application/json' },
    onlyIf: { etagDoesNotMatch: '*' },
  })
  return result !== null
}

/** Append a bundleId to an index file with If-Match retry. Idempotent. */
export async function indexAdd(env: R2Like, key: string, bundleId: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await env.PROPOSALS.get(key)
    let index: IndexFile
    let etag: string | undefined
    if (existing) {
      etag  = stripEtag(existing.httpEtag)
      index = await existing.json<IndexFile>()
      if (index.bundleIds.includes(bundleId)) return
    } else {
      index = { bundleIds: [] }
    }
    index.bundleIds.push(bundleId)
    const opts: R2PutOptions = {
      httpMetadata: { contentType: 'application/json' },
      onlyIf:       etag ? { etagMatches: etag } : { etagDoesNotMatch: '*' },
    }
    const result = await env.PROPOSALS.put(key, JSON.stringify(index), opts)
    if (result) return
  }
  throw new Error(`indexAdd: conditional write failed after 3 attempts (${key})`)
}

/** Remove a bundleId from an index file with If-Match retry. Idempotent. */
export async function indexRemove(env: R2Like, key: string, bundleId: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await env.PROPOSALS.get(key)
    if (!existing) return  // nothing to remove
    const etag    = stripEtag(existing.httpEtag)
    const index   = await existing.json<IndexFile>()
    const filtered = index.bundleIds.filter((b) => b !== bundleId)
    if (filtered.length === index.bundleIds.length) return  // wasn't there

    const next: IndexFile = { bundleIds: filtered }
    const opts: R2PutOptions = {
      httpMetadata: { contentType: 'application/json' },
      onlyIf:       { etagMatches: etag },
    }
    if (filtered.length === 0) {
      // Keep the (empty) index file rather than delete — simpler invariant
      // for readers, who treat absent and empty-array equivalently.
    }
    const result = await env.PROPOSALS.put(key, JSON.stringify(next), opts)
    if (result) return
  }
  throw new Error(`indexRemove: conditional write failed after 3 attempts (${key})`)
}

/**
 * Patch the manifest's entity status with If-Match retry. Returns the
 * post-update manifest so the caller can decide bundleClosed / archive.
 */
export async function manifestSetStatus(
  env:       R2Like,
  bundleId:  string,
  entityId:  string,
  status:    'accepted' | 'denied' | 'drifted',
  refusal?:  DriftedProp[],
): Promise<BundleManifest> {
  const key = `proposals/bundles/${bundleId}/manifest.json`
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await env.PROPOSALS.get(key)
    if (!existing) throw new Error(`manifestSetStatus: bundle ${bundleId} not found`)
    const etag     = stripEtag(existing.httpEtag)
    const manifest = await existing.json<BundleManifest>()
    const ent      = manifest.entities.find((e) => e.entityId === entityId)
    if (!ent)      throw new Error(`manifestSetStatus: entity ${entityId} not in bundle ${bundleId}`)
    ent.status     = status
    if (refusal?.length) ent.refusal = refusal
    const result   = await env.PROPOSALS.put(key, JSON.stringify(manifest), {
      httpMetadata: { contentType: 'application/json' },
      onlyIf:       { etagMatches: etag },
    })
    if (result) return manifest
  }
  throw new Error(`manifestSetStatus: conditional write failed after 3 attempts`)
}

/**
 * Accept refused an entity for a reason that will not go away (it exists, a property changed): set it aside, with the
 * reason, so the bundle does not count it as waiting and the reviewer can see why. It leaves the open-bundle lists like a
 * decided entity does (#185). The reviewer can still deny it.
 */
export async function setAside(env: R2Like, bundleId: string, entityId: string, refusal: DriftedProp[]): Promise<BundleManifest> {
  const manifest = await manifestSetStatus(env, bundleId, entityId, 'drifted', refusal)
  await indexRemove(env, `proposals/by-entity/${entityId}/index.json`, bundleId)
  if (bundleCounts(manifest.entities).pending === 0) await indexRemove(env, sourceIndexKey(manifest), bundleId)
  return manifest
}

/** R2's `httpEtag` returns the HTTP-quoted form (`"abc"`); the conditional
 *  put's `etagMatches` rejects the quotes. Strip them. */
function stripEtag(etag: string): string {
  return etag.replace(/^"(.*)"$/, '$1')
}
