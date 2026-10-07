/**
 * A package: entity snapshots that can leave one archive and be compared with another's graph
 * (docs/BUNDLE-FORMAT.md, #159).
 *
 * A package says how entities *should be*; it does not say what to change. Turning one into a
 * review bundle is a comparison with the live graph (snapshot-diff.ts). It carries no Sanity
 * metadata: `sanityId`, `sanityRev`, the `<field>_sha` stamps and the like are the sync bridge's
 * bookkeeping, which goes the day Jan stops editing in Sanity (docs/SANITY-SYNC.md, *Cutover*).
 */

import { parseNodeRef } from './entity-ref.ts'

export const PACKAGE_SCHEMA_VERSION = 1

/** Where an entity lives in the archive it came from: the archive's address and the path to the entity. */
export interface SourceRef {
  site: string
  /** The entity's path on that site, for example `/transport/mtb-683`. */
  path: string
}

export interface EdgeSnapshot {
  type:   string
  /** `<Kind>:<key>` (functions/_lib/entity-ref.ts). */
  to:     string
  props?: Record<string, unknown>
}

/** One `Description` of an entity: its order and its Portable Text as stored (a JSON string of blocks). */
export interface DescriptionSnapshot {
  order:   number
  content: string
}

export interface EntitySnapshot {
  kind:         string
  /** The slug, or for a `Source` its id (`keyProp` in entity-ref.ts). */
  key:          string
  props:        Record<string, unknown>
  descriptions: DescriptionSnapshot[]
  /** Outbound edges only: an edge belongs to the entity it leaves. */
  edges:        EdgeSnapshot[]
  source:       SourceRef
}

export interface PackageOrigin {
  /** The address of the archive the package was made on. */
  site:    string
  madeAt:  string
  /** What was selected, in words or as the filter that was used. Informational. */
  filter?: string
}

export interface BundlePackage {
  schemaVersion: number
  origin:        PackageOrigin
  entities:      EntitySnapshot[]
}

/* ───────────────────────── bridge metadata ───────────────────────── */

/**
 * A property is the bridge's bookkeeping, not content, when
 *  - its name mentions Sanity (`sanityId`, `sanityRev`, `description_sanityUpdatedAt`, `sanityOutlineId`, …),
 *  - it is a hash stamp (`description_sha`, `links_sha`, `sha`), or
 *  - it is a `<field>_sourceRef`: in the graph its value is `sanity-migration:<type>:<Sanity document id>:<field>`,
 *    a Sanity id inside a value.
 * Everything else goes with the entity. `lat_state` and the other `<field>_state` stay: `candidate` says how
 * sure a value is, which a reader of the receiving archive can use.
 */
export const isBridgeProp = (name: string): boolean => /sanity/i.test(name) || /(^|_)sha$/i.test(name) || /_sourceRef$/.test(name)

/** `props` without the bridge's bookkeeping, and the names that were taken out. */
export function stripBridgeProps(props: Record<string, unknown>): { kept: Record<string, unknown>; dropped: string[] } {
  const kept: Record<string, unknown> = {}
  const dropped: string[] = []
  for (const [name, value] of Object.entries(props)) {
    if (isBridgeProp(name)) dropped.push(name)
    else kept[name] = value
  }
  return { kept, dropped }
}

/* ───────────────────────── paths ───────────────────────── */

/**
 * The path of an entity on a site that runs this application (src/router/index.ts), or null when the
 * kind has no page of its own (an Article, a Source): the exporter then gives the path itself.
 */
export function entityPath(kind: string, key: string): string | null {
  switch (kind) {
    case 'Person':        return `/person/${key}`
    case 'Station':       return `/station/${key}`
    case 'Location':      return `/location/${key}`
    case 'Transport':     return `/transport/${key}`
    case 'EquipmentType': return `/equipment/${key}`
    case 'Organization':  return `/organization/${key}`
    case 'Operation':
    case 'Incident':      return `/events/${key}`
    case 'Outline':
    case 'Unit':          return `/outlines/${key}`
    default:              return null
  }
}

/* ───────────────────────── building ───────────────────────── */

export interface EntityInput {
  kind:          string
  key:           string
  /** The node's properties as they are in the graph, bridge bookkeeping and identity included. */
  props:         Record<string, unknown>
  descriptions?: DescriptionSnapshot[]
  edges?:        EdgeSnapshot[]
  source:        SourceRef
}

const byOrder = (a: DescriptionSnapshot, b: DescriptionSnapshot) => a.order - b.order
const byEdge  = (a: EdgeSnapshot, b: EdgeSnapshot) => `${a.type}|${a.to}`.localeCompare(`${b.type}|${b.to}`)

/** The identity of a node is its key, not a property: it never travels as one. */
const IDENTITY_PROPS = new Set(['slug', 'id'])

/**
 * One entity as a snapshot: the bridge's bookkeeping and the identity property taken out, descriptions
 * and edges in a fixed order (so the same entity always gives the same snapshot).
 */
export function makeEntitySnapshot(input: EntityInput): EntitySnapshot {
  const { kept } = stripBridgeProps(input.props)
  for (const name of IDENTITY_PROPS) delete kept[name]
  return {
    kind:         input.kind,
    key:          input.key,
    props:        kept,
    descriptions: [...(input.descriptions ?? [])].sort(byOrder),
    edges:        (input.edges ?? []).map(e => {
      const props = e.props ? stripBridgeProps(e.props).kept : undefined
      return props && Object.keys(props).length ? { type: e.type, to: e.to, props } : { type: e.type, to: e.to }
    }).sort(byEdge),
    source:       input.source,
  }
}

export const refOf = (e: { kind: string; key: string }) => `${e.kind}:${e.key}`

export function makePackage(origin: PackageOrigin, entities: EntitySnapshot[]): BundlePackage {
  return {
    schemaVersion: PACKAGE_SCHEMA_VERSION,
    origin,
    entities: [...entities].sort((a, b) => refOf(a).localeCompare(refOf(b))),
  }
}

/* ───────────────────────── validation ───────────────────────── */

const KIND_RE = /^[A-Za-z]+$/
const KEY_RE  = /^\S+$/

/** Every reason a package cannot be used; an empty list when it can. */
export function validatePackage(value: unknown): string[] {
  const problems: string[] = []
  const p = value as Partial<BundlePackage> | null
  if (!p || typeof p !== 'object') return ['the package is not an object']

  if (p.schemaVersion !== PACKAGE_SCHEMA_VERSION) problems.push(`schemaVersion must be ${PACKAGE_SCHEMA_VERSION}, got ${String(p.schemaVersion)}`)
  if (typeof p.origin?.site !== 'string' || !p.origin.site) problems.push('origin.site is required')
  if (typeof p.origin?.madeAt !== 'string' || !p.origin.madeAt) problems.push('origin.madeAt is required')
  if (!Array.isArray(p.entities)) return [...problems, 'entities must be a list']

  const seen = new Set<string>()
  for (const e of p.entities as Partial<EntitySnapshot>[]) {
    const ref = `${String(e?.kind)}:${String(e?.key)}`
    const at = `entity ${ref}`
    if (typeof e?.kind !== 'string' || !KIND_RE.test(e.kind)) { problems.push(`${at}: kind must be letters only`); continue }
    if (typeof e.key !== 'string' || !KEY_RE.test(e.key))     { problems.push(`${at}: key is required and has no spaces`); continue }
    if (seen.has(ref)) problems.push(`${at}: appears twice`)
    seen.add(ref)

    if (typeof e.source?.site !== 'string' || !e.source.site)       problems.push(`${at}: source.site is required`)
    if (typeof e.source?.path !== 'string' || !e.source.path.startsWith('/')) problems.push(`${at}: source.path must start with /`)

    if (!e.props || typeof e.props !== 'object' || Array.isArray(e.props)) problems.push(`${at}: props must be an object`)
    else {
      for (const name of Object.keys(e.props)) {
        if (isBridgeProp(name)) problems.push(`${at}: prop «${name}» is the sync bridge's bookkeeping and does not belong in a package`)
        if (IDENTITY_PROPS.has(name)) problems.push(`${at}: prop «${name}» is the key and does not travel as a property`)
      }
    }

    if (!Array.isArray(e.descriptions)) problems.push(`${at}: descriptions must be a list`)
    else {
      const orders = new Set<number>()
      for (const d of e.descriptions) {
        if (!Number.isInteger(d?.order) || d.order < 1) problems.push(`${at}: a description needs an order of 1 or more`)
        else if (orders.has(d.order)) problems.push(`${at}: description order ${d.order} appears twice`)
        else orders.add(d.order)
        if (typeof d?.content !== 'string') problems.push(`${at}: a description's content must be a JSON string of blocks`)
        else {
          try { if (!Array.isArray(JSON.parse(d.content))) problems.push(`${at}: description ${d.order} is not a list of blocks`) }
          catch { problems.push(`${at}: description ${d.order} is not JSON`) }
        }
      }
    }

    if (!Array.isArray(e.edges)) problems.push(`${at}: edges must be a list`)
    else {
      for (const edge of e.edges) {
        if (typeof edge?.type !== 'string' || !/^[A-Z][A-Z_]*$/.test(edge.type)) problems.push(`${at}: an edge needs a type like MEMBER_OF`)
        if (typeof edge?.to !== 'string' || !parseNodeRef(edge.to)) problems.push(`${at}: edge to «${String(edge?.to)}» is not a <Kind>:<key> reference`)
        for (const name of Object.keys(edge?.props ?? {})) {
          if (isBridgeProp(name)) problems.push(`${at}: edge prop «${name}» is the sync bridge's bookkeeping and does not belong in a package`)
        }
      }
    }
  }
  return problems
}
