/**
 * Validation of an ingested bundle: the shape of the manifest, the entities and their ops
 * (docs/PROPOSALS.md, *Bundle shape*). Pure, so it is tested, and so a bundle written by a script
 * (scripts/bundles/package-to-bundle.ts) can be checked against exactly what ingest checks.
 * Moved out of functions/api/proposals/ingest.ts, which keeps the request handling and R2.
 */

import {
  bundleChannel, validateDerivedFrom, validateOrigin,
  type BundleOriginFields, type DerivedFrom,
} from './bundle-origin.ts'
import { isBridgeProp } from './bundle-package.ts'
import { ENTITY_ID_RE, isNodeRef } from './entity-ref.ts'

export const ENTITY_KINDS = new Set([
  'Person', 'Unit', 'Station', 'Transport',
  'Operation', 'Incident', 'Location', 'Outline', 'Organization',
  // Added for packages and the conversion of earlier absorptions (#161). A Source is keyed by `id`, not `slug`
  // (entity-ref.ts), so only a Source whose id is slug-like (a-z, 0-9, -) can be a bundle's entity.
  'Article', 'EquipmentType', 'Source',
])
export const OP_TYPES = new Set([
  'create-entity', 'modify-block', 'add-edge', 'remove-edge',
  'delete-entity', 'obsolete-outline', 'set-props', 'set-kind', 'set-description',
])
const SLUG_RE        = /^[a-z0-9-]+$/
const PROP_NAME_RE   = /^[A-Za-z][A-Za-z0-9_]*$/
/** Never set through set-props: identity and provenance the sync owns. */
const PROTECTED_PROPS = new Set(['slug', 'sanityId', 'id'])
const BLOCK_PATH_RE  = /^section\.[a-z0-9-]+\.block\.[A-Za-z0-9_-]+$/
const BUNDLE_ID_RE   = /^bundle:[a-z0-9-]+:[0-9TZ:.-]+$/

export interface BundleEntityRef {
  entityId:  string
  status:    'pending' | 'accepted' | 'denied' | 'drifted'
  opSummary: string[]
}

export interface BundleManifest extends BundleOriginFields {
  bundleId:         string
  summary:          string
  createdAt:        string
  model:            string
  promptHash:       string
  entities:         BundleEntityRef[]
  /** 'blocked' = at least one edge target neither lives nor is being
   *  created in this bundle; the bundle waits for child bundles to
   *  resolve `unresolvedRefs` before Jan can review. 'pending' on a
   *  parent flips to 'closed' once every entity is non-pending. */
  status?:          'pending' | 'blocked' | 'closed'
  unresolvedRefs?:  string[]
  /** Set on a child bundle generated to resolve a parent's unresolved
   *  ref. The child manifest is otherwise identical to a parent's. */
  parentBundle?:    string
  resolvesEntities?: string[]
}

export interface InitialDescription { order: number; content: string }

export type BundleOp =
  | { op: 'create-entity'; kind: string; slug: string; props: Record<string, unknown>; edges?: { type: string; to: string; props?: Record<string, unknown> }[]; descriptions?: InitialDescription[] }
  | { op: 'modify-block'; blockPath: string; expectedSha: string; newValue: Record<string, unknown> }
  | { op: 'add-edge';     type: string; from: string; to: string; props?: Record<string, unknown> }
  | { op: 'remove-edge';  type: string; from: string; to: string }
  | { op: 'set-description'; order: number; expectedSha: string; content: string }
  | { op: 'delete-entity' }
  | { op: 'obsolete-outline'; reason: string }
  | { op: 'set-props';        props: Record<string, { from: unknown; to: unknown }> }
  | { op: 'set-kind';         to: 'Operation' | 'Incident' }

export interface EntityPayload {
  entityId:    string
  ops:         BundleOp[]
  derivedFrom: DerivedFrom
  source:      string
  generatedAt: string
  /** Set when an entity was matched by slug alone (a package): shown in the review, so it can be confirmed. */
  note?:       string
}

export interface IngestBody {
  bundleId:    unknown
  outlineId?:  unknown
  outlineRev?: unknown
  origin?:     unknown
  summary:     unknown
  createdAt:   unknown
  model?:      unknown
  promptHash?: unknown
  entities:    unknown  // [{entityId, ops, derivedFrom, source, generatedAt}]
  issueNumber?: unknown
}

export interface ValidatedBundle {
  manifest: BundleManifest
  payloads: Map<string, EntityPayload>  // keyed by entityId
  issueNumber: number | null
}

export function validateBundle(b: IngestBody): ValidatedBundle | string {
  if (typeof b.bundleId !== 'string' || !BUNDLE_ID_RE.test(b.bundleId)) {
    return 'bundleId must match `bundle:<channel>:<isoTimestamp>`'
  }
  const origin = validateOrigin(b as unknown as Record<string, unknown>)
  if (typeof origin === 'string') return origin
  if (!b.bundleId.startsWith(`bundle:${bundleChannel(origin)}:`)) {
    return `bundleId must start with bundle:${bundleChannel(origin)}:`
  }
  if (typeof b.summary    !== 'string' || !b.summary)                return 'summary required'
  if (typeof b.createdAt  !== 'string' || !b.createdAt)              return 'createdAt required (ISO-8601)'
  // A bundle made from a package has no model and no prompt.
  const fromPackage = origin.origin?.type === 'package'
  const model      = fromPackage ? (typeof b.model      === 'string' && b.model      ? b.model      : 'none') : b.model
  const promptHash = fromPackage ? (typeof b.promptHash === 'string' && b.promptHash ? b.promptHash : 'none') : b.promptHash
  if (typeof model      !== 'string' || !model)                      return 'model required'
  if (typeof promptHash !== 'string' || !promptHash)                 return 'promptHash required'
  if (!Array.isArray(b.entities) || !b.entities.length)              return 'entities must be a non-empty array'

  const payloads = new Map<string, EntityPayload>()
  const entityRefs: BundleEntityRef[] = []

  for (const e of b.entities) {
    if (!e || typeof e !== 'object') return 'entities[] entries must be objects'
    const ent = e as Record<string, unknown>
    if (typeof ent.entityId !== 'string') return 'entities[].entityId required'
    const eid = ent.entityId

    const idMatch = eid.match(ENTITY_ID_RE)
    if (!idMatch) return `entities[].entityId "${eid}" must match \`<Kind>:<slug>\``
    const [, kind] = idMatch
    if (!ENTITY_KINDS.has(kind)) return `entities[].entityId "${eid}" — unknown kind: ${kind}`

    if (!Array.isArray(ent.ops) || !ent.ops.length) return `entities[${eid}].ops must be a non-empty array`

    const validatedOps: BundleOp[] = []
    const opSummary: string[] = []

    for (const rawOp of ent.ops) {
      if (!rawOp || typeof rawOp !== 'object') return `entities[${eid}].ops[] entries must be objects`
      const op = rawOp as Record<string, unknown>
      if (typeof op.op !== 'string' || !OP_TYPES.has(op.op)) {
        return `entities[${eid}].ops[].op must be one of: ${[...OP_TYPES].join(', ')} (got "${String(op.op)}")`
      }

      const opErr = validateOp(eid, op, origin)
      if (typeof opErr === 'string') return opErr

      validatedOps.push(op as BundleOp)
      opSummary.push(summarizeOp(op as BundleOp))
    }

    const df = validateDerivedFrom(origin, ent.derivedFrom)
    if (typeof df === 'string') return `entities[${eid}].${df}`

    payloads.set(eid, {
      entityId:    eid,
      ops:         validatedOps,
      derivedFrom: df,
      source:      typeof ent.source === 'string' ? ent.source
                 : 'outlineId' in df ? `claude:outline:${df.outlineId}`
                 : 'source' in df    ? `package:${df.source.site}${df.source.path}`
                 : `sanity:${df.sanityId}`,
      generatedAt: typeof ent.generatedAt === 'string' ? ent.generatedAt : b.createdAt,
      ...(typeof ent.note === 'string' && ent.note ? { note: ent.note } : {}),
    })
    if (typeof ent.note === 'string' && ent.note) opSummary.push(`⚠ ${ent.note}`)
    entityRefs.push({ entityId: eid, status: 'pending', opSummary })
  }

  return {
    manifest: {
      bundleId:   b.bundleId,
      ...origin,
      summary:    b.summary,
      createdAt:  b.createdAt,
      model,
      promptHash,
      entities:   entityRefs,
    },
    payloads,
    issueNumber: typeof b.issueNumber === 'number' ? b.issueNumber : null,
  }
}

function validateOp(eid: string, op: Record<string, unknown>, origin: BundleOriginFields): string | null {
  // A package carries entities, not the bridge's bookkeeping (docs/BUNDLE-FORMAT.md): refused at the door.
  const bridge = origin.origin?.type === 'package' ? bridgePropIn(eid, op) : null
  if (bridge) return bridge
  switch (op.op) {
    case 'create-entity': {
      if (typeof op.kind !== 'string' || !ENTITY_KINDS.has(op.kind))    return `${eid} create-entity: kind invalid`
      if (typeof op.slug !== 'string' || !SLUG_RE.test(op.slug))        return `${eid} create-entity: slug must match /^[a-z0-9-]+$/`
      if (`${op.kind}:${op.slug}` !== eid)                              return `${eid} create-entity: kind:slug must match the entity's entityId`
      if (!op.props || typeof op.props !== 'object')                    return `${eid} create-entity: props required`
      if (op.edges !== undefined) {
        if (!Array.isArray(op.edges)) return `${eid} create-entity: edges must be an array`
        for (const edge of op.edges) {
          const err = validateEdge(eid, edge as Record<string, unknown>)
          if (err) return err
        }
      }
      if (op.descriptions !== undefined) {
        if (!Array.isArray(op.descriptions)) return `${eid} create-entity: descriptions must be an array`
        for (const d of op.descriptions) {
          if (!d || typeof d !== 'object')                                  return `${eid} create-entity: description must be object`
          const dd = d as Record<string, unknown>
          if (!Number.isInteger(dd.order) || (dd.order as number) < 1)      return `${eid} create-entity: description.order must be int >= 1`
          if (typeof dd.content !== 'string')                                return `${eid} create-entity: description.content must be string (JSON-encoded PT array)`
          try { JSON.parse(dd.content) } catch                                { return `${eid} create-entity: description.content must be JSON` }
        }
      }
      return null
    }
    case 'modify-block': {
      if (typeof op.blockPath !== 'string' || !BLOCK_PATH_RE.test(op.blockPath)) return `${eid} modify-block: blockPath must match section.<slug>.block.<key>`
      if (typeof op.expectedSha !== 'string')                                    return `${eid} modify-block: expectedSha required (may be empty for v1)`
      if (!op.newValue || typeof op.newValue !== 'object')                       return `${eid} modify-block: newValue required`
      const nv = op.newValue as Record<string, unknown>
      if (nv._type !== 'block' || !Array.isArray(nv.children))                   return `${eid} modify-block: newValue must be PT block (_type "block", children[])`
      return null
    }
    case 'add-edge':
    case 'remove-edge': {
      if (typeof op.type !== 'string' || !op.type)                                  return `${eid} ${op.op}: type required`
      if (!isNodeRef(op.from))                                                      return `${eid} ${op.op}: from must be <Kind>:<slug> or Source:<id>`
      if (!isNodeRef(op.to))                                                        return `${eid} ${op.op}: to must be <Kind>:<slug> or Source:<id>`
      // For add-edge, the target must resolve. v1: we accept "live entity" optimistically — only check that
      // edges to entities-being-created-elsewhere-in-this-bundle do resolve (caught by pass-1 createdEntityIds).
      // Live-entity existence is validated at apply time.
      return null
    }
    case 'delete-entity':     return null
    case 'set-description': {
      if (!Number.isInteger(op.order) || (op.order as number) < 1)  return `${eid} set-description: order must be int >= 1`
      if (typeof op.expectedSha !== 'string')                        return `${eid} set-description: expectedSha required (empty when the description does not exist yet)`
      if (typeof op.content !== 'string')                            return `${eid} set-description: content must be a string (JSON-encoded PT array)`
      try { if (!Array.isArray(JSON.parse(op.content))) return `${eid} set-description: content must be a JSON array of blocks` }
      catch { return `${eid} set-description: content must be JSON` }
      return null
    }
    case 'set-props': {
      const props = op.props as Record<string, unknown> | undefined
      if (!props || typeof props !== 'object' || !Object.keys(props).length) return `${eid} set-props: props must be a non-empty object`
      for (const [name, change] of Object.entries(props)) {
        if (!PROP_NAME_RE.test(name) || PROTECTED_PROPS.has(name)) return `${eid} set-props: property "${name}" not allowed`
        const c = change as Record<string, unknown> | null
        if (!c || typeof c !== 'object' || !('from' in c) || !('to' in c)) return `${eid} set-props: ${name} needs {from, to}`
        const scalar = (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v)
        if (!scalar(c.from) || !scalar(c.to)) return `${eid} set-props: ${name} from/to must be scalars or null`
      }
      return null
    }
    case 'set-kind': {
      const kind = eid.match(ENTITY_ID_RE)?.[1]
      if (kind !== 'Operation' && kind !== 'Incident')      return `${eid} set-kind: only valid on Operation/Incident entities`
      if (op.to !== 'Operation' && op.to !== 'Incident')    return `${eid} set-kind: to must be "Operation" or "Incident"`
      if (op.to === kind)                                    return `${eid} set-kind: already ${kind}`
      return null
    }
    case 'obsolete-outline': {
      if (typeof op.reason !== 'string' || !op.reason) return `${eid} obsolete-outline: reason required`
      const idMatch = eid.match(ENTITY_ID_RE)
      if (!idMatch || idMatch[1] !== 'Outline')        return `${eid} obsolete-outline: only valid on Outline entities`
      return null
    }
    default: return `${eid} unknown op: ${String(op.op)}`
  }
}

function validateEdge(eid: string, edge: Record<string, unknown>): string | null {
  if (!edge || typeof edge !== 'object')                              return `${eid} create-entity: edge must be object`
  if (typeof edge.type !== 'string' || !edge.type)                    return `${eid} create-entity: edge.type required`
  if (!isNodeRef(edge.to))                                             return `${eid} create-entity: edge.to must be <Kind>:<slug> or Source:<id>`
  // v1: don't enforce that edge.to resolves — apply-time check will catch.
  return null
}

/**
 * A package's ops must not carry the bridge's bookkeeping (isBridgeProp in bundle-package.ts): not as
 * the properties of a new entity, in a set-props, or on an edge. Null when they do not.
 */
function bridgePropIn(eid: string, op: Record<string, unknown>): string | null {
  const names: string[] = []
  const props = (v: unknown) => { if (v && typeof v === 'object') names.push(...Object.keys(v)) }
  if (op.op === 'create-entity') {
    props(op.props)
    for (const e of (Array.isArray(op.edges) ? op.edges : []) as Record<string, unknown>[]) props(e?.props)
  }
  if (op.op === 'set-props')      props(op.props)
  if (op.op === 'add-edge')       props(op.props)
  const bad = [...new Set(names.filter(isBridgeProp))]
  return bad.length ? `${eid} ${String(op.op)}: ${bad.map(n => `«${n}»`).join(', ')} ${bad.length === 1 ? 'is' : 'are'} the sync bridge's bookkeeping and does not belong in a package` : null
}

export function summarizeOp(op: BundleOp): string {
  switch (op.op) {
    case 'create-entity':    return `create${op.edges?.length ? ` (+${op.edges.length} edge${op.edges.length === 1 ? '' : 's'})` : ''}`
    case 'modify-block':     return `modify ${op.blockPath}`
    case 'add-edge':         return `+${op.type} → ${op.to}`
    case 'remove-edge':      return `-${op.type} → ${op.to}`
    case 'delete-entity':    return 'delete'
    case 'set-description':  return `description ${op.order}: ${op.expectedSha ? 'replaced' : 'new'}`
    case 'obsolete-outline': return 'archive'
    case 'set-props':        return Object.entries(op.props)
      .map(([k, { from, to }]) => `${k}: ${fmt(from)} → ${fmt(to)}`).join('; ')
    case 'set-kind':         return op.to === 'Incident'
      ? 'kind → Incident (drops ORCHESTRATED_BY and unit participation)'
      : 'kind → Operation'
  }
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === '') return '∅'
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > 60 ? `«${s.slice(0, 57)}…»` : `«${s}»`
}

