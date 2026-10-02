/**
 * Where a proposal bundle comes from (docs/PROPOSALS.md, "Bundle origin").
 *
 *   outline — Claude absorbing an outline: `outlineId` + `outlineRev` on the
 *             manifest, `{outlineId, outlineRev, sectionPath?}` per entity.
 *             The outline is archived once its bundle is fully accepted.
 *   sanity  — the Sanity → graph sync (docs/SANITY-SYNC.md): `origin` on the
 *             manifest, `{sanityId, sanityRev}` per entity. No archive, no
 *             GitHub issue, no Claude resolve dispatch.
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

export interface BundleOriginFields {
  outlineId?:  string
  outlineRev?: string
  origin?:     SanityOrigin
}

export type DerivedFrom =
  | { outlineId: string; outlineRev: string; sectionPath?: string }
  | { sanityId: string; sanityRev: string }

const SLUG_RE = /^[a-z0-9-]+$/

/** Live-update channel and source-index key. */
export function bundleChannel(m: BundleOriginFields): string {
  if (m.outlineId) return m.outlineId
  if (m.origin?.type === 'sanity') return `sanity-${m.origin.sanityType}`
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
  if (!o || o.type !== 'sanity') return 'outlineId/outlineRev or origin {type: "sanity"} required'
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
  if (typeof d.sanityId !== 'string' || !d.sanityId || typeof d.sanityRev !== 'string') return 'derivedFrom must include sanityId + sanityRev'
  return { sanityId: d.sanityId, sanityRev: d.sanityRev }
}

/** Short human label: "outline linge-pulje-4" / "Sanity event". */
export function originLabel(m: BundleOriginFields): string {
  return m.outlineId ? `outline ${m.outlineId}` : `Sanity ${m.origin?.sanityType ?? '?'}`
}
