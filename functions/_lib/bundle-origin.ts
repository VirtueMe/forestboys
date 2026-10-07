/**
 * Where a proposal bundle comes from (docs/PROPOSALS.md, "Bundle origin").
 *
 *   outline — Claude absorbing an outline: `outlineId` + `outlineRev` on the
 *             manifest, `{outlineId, outlineRev, sectionPath?}` per entity.
 *             The outline is archived once its bundle is fully accepted.
 *   sanity  — the Sanity → graph sync (docs/SANITY-SYNC.md): `origin` on the
 *             manifest, `{sanityId, sanityRev}` per entity. No archive, no
 *             GitHub issue, no Claude resolve dispatch.
 *   package — a package of entity snapshots compared with the graph
 *             (docs/BUNDLE-FORMAT.md, #159): `origin: {type: 'package', site,
 *             madeAt}` on the manifest, `{source: {site, path}}` per entity (where
 *             the entity lives in the archive it came from). Like a sync bundle:
 *             no archive, no GitHub issue, no Claude dispatch. No model, no prompt.
 *
 * The channel — `outlineId`, or `sanity-<type>` — keys the live-update stream
 * (BUNDLE_EVENTS) and the source index.
 */

export interface SanityOrigin {
  type:       'sanity'
  /** Sanity document type, e.g. 'event'. */
  sanityType: string
  /** When the sync run that made the bundle started (ISO). */
  runAt:      string
}

export interface PackageOrigin {
  type:   'package'
  /** The address of the archive the package was made on. */
  site:   string
  madeAt: string
}

export interface BundleOriginFields {
  outlineId?:  string
  outlineRev?: string
  origin?:     SanityOrigin | PackageOrigin
}

export type DerivedFrom =
  | { outlineId: string; outlineRev: string; sectionPath?: string }
  | { sanityId: string; sanityRev: string }
  | { source: { site: string; path: string } }

/** `https://Archive.example:8080/x` → `archive-example-8080-x`: a piece of a channel or a bundle id. */
export function siteSlug(site: string): string {
  return site.toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'site'
}

const SLUG_RE = /^[a-z0-9-]+$/

/** Live-update channel and source-index key. */
export function bundleChannel(m: BundleOriginFields): string {
  if (m.outlineId) return m.outlineId
  if (m.origin?.type === 'sanity')  return `sanity-${m.origin.sanityType}`
  if (m.origin?.type === 'package') return `package-${siteSlug(m.origin.site)}`
  throw new Error('bundle has neither outlineId nor origin')
}

export function sourceIndexKey(m: BundleOriginFields): string {
  return m.outlineId
    ? `proposals/by-outline/${m.outlineId}/index.json`
    : `proposals/by-source/${bundleChannel(m)}/index.json`
}

export function isOutlineBundle(m: BundleOriginFields): m is BundleOriginFields & { outlineId: string; outlineRev: string } {
  return typeof m.outlineId === 'string'
}

/** Validate the origin fields of an ingest body. Returns the fields or an error string. */
export function validateOrigin(b: Record<string, unknown>): BundleOriginFields | string {
  if (b.outlineId !== undefined || b.outlineRev !== undefined) {
    if (b.origin !== undefined) return 'give either outlineId/outlineRev or origin, not both'
    if (typeof b.outlineId !== 'string' || !SLUG_RE.test(b.outlineId)) return 'outlineId must match /^[a-z0-9-]+$/'
    if (typeof b.outlineRev !== 'string' || !b.outlineRev)            return 'outlineRev required'
    return { outlineId: b.outlineId, outlineRev: b.outlineRev }
  }
  const o = b.origin as Record<string, unknown> | undefined
  if (o?.type === 'package') {
    if (typeof o.site !== 'string' || !/^https?:\/\/\S+$/.test(o.site)) return 'origin.site must be the address of the archive (https://…)'
    if (typeof o.madeAt !== 'string' || !o.madeAt)                     return 'origin.madeAt required (ISO-8601)'
    return { origin: { type: 'package', site: o.site, madeAt: o.madeAt } }
  }
  if (!o || o.type !== 'sanity') return 'outlineId/outlineRev or origin {type: "sanity" | "package"} required'
  if (typeof o.sanityType !== 'string' || !SLUG_RE.test(o.sanityType)) return 'origin.sanityType must match /^[a-z0-9-]+$/'
  if (typeof o.runAt !== 'string' || !o.runAt)                         return 'origin.runAt required (ISO-8601)'
  return { origin: { type: 'sanity', sanityType: o.sanityType, runAt: o.runAt } }
}

/** Validate one entity's derivedFrom against the bundle's origin. */
export function validateDerivedFrom(origin: BundleOriginFields, df: unknown): DerivedFrom | string {
  const d = df as Record<string, unknown> | undefined
  if (!d) return 'derivedFrom required'
  if (isOutlineBundle(origin)) {
    if (typeof d.outlineId !== 'string' || typeof d.outlineRev !== 'string') return 'derivedFrom must include outlineId + outlineRev'
    return { outlineId: d.outlineId, outlineRev: d.outlineRev, sectionPath: typeof d.sectionPath === 'string' ? d.sectionPath : undefined }
  }
  if (origin.origin?.type === 'package') {
    const src = d.source as Record<string, unknown> | undefined
    if (!src || typeof src.site !== 'string' || !src.site)                       return 'derivedFrom must include source.site'
    if (typeof src.path !== 'string' || !src.path.startsWith('/'))                return 'derivedFrom.source.path must start with /'
    return { source: { site: src.site, path: src.path } }
  }
  if (typeof d.sanityId !== 'string' || !d.sanityId || typeof d.sanityRev !== 'string') return 'derivedFrom must include sanityId + sanityRev'
  return { sanityId: d.sanityId, sanityRev: d.sanityRev }
}

/** Short human label: "outline linge-pulje-4" / "Sanity event" / "package from https://archive.example". */
export function originLabel(m: BundleOriginFields): string {
  if (m.outlineId) return `outline ${m.outlineId}`
  if (m.origin?.type === 'package') return `package from ${m.origin.site}`
  return `Sanity ${m.origin?.type === 'sanity' ? m.origin.sanityType : '?'}`
}
