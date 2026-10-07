/**
 * The body of a review bundle made from a package's comparison with the graph (docs/BUNDLE-FORMAT.md, #159).
 *
 * The same envelope as every bundle (docs/PROPOSALS.md, *Bundle shape*), with the origin `package`: the
 * archive the package came from, and per entity the source ref it was made from. Ingest learns the origin,
 * the `set-description` op and the `note` field in #161; until then this is what is written to a file and
 * read, not what is sent.
 */

import type { BundlePackage, SourceRef } from './bundle-package.ts'
import type { DiffOp, PackageDiff } from './snapshot-diff.ts'

export interface PackageBundleEntity {
  entityId:    string
  ops:         DiffOp[]
  derivedFrom: { source: SourceRef }
  /** A short label of where the entity came from, like the `claude:outline:…` of a bot bundle. */
  source:      string
  generatedAt: string
  /** Set when the entity was matched by slug alone: proposed as the same, for the admin to confirm. */
  note?:       string
}

export interface PackageBundleBody {
  bundleId:   string
  origin:     { type: 'package'; site: string; madeAt: string }
  summary:    string
  createdAt:  string
  /** A bundle made from a package has no model and no prompt. */
  model:      'none'
  promptHash: 'none'
  entities:   PackageBundleEntity[]
}

/** `https://Archive.example:8080/x` → `archive-example-8080-x`: a piece of a bundle id (`bundle:<this>:<time>`). */
export function siteSlug(site: string): string {
  return site.toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'site'
}

/** The bundle for a package's differences, or null when the graph already holds everything. */
export function buildBundleBody(pkg: BundlePackage, diff: PackageDiff, now: string): PackageBundleBody | null {
  if (!diff.entities.length) return null
  const created = diff.entities.filter(e => e.ops[0]?.op === 'create-entity').length
  const changed = diff.entities.length - created
  const bits = [created && `${created} new`, changed && `${changed} changed`, diff.unchanged.length && `${diff.unchanged.length} already up to date`].filter(Boolean)
  return {
    bundleId:   `bundle:package-${siteSlug(pkg.origin.site)}:${now}`,
    origin:     { type: 'package', site: pkg.origin.site, madeAt: pkg.origin.madeAt },
    summary:    `Import from ${pkg.origin.site}${pkg.origin.filter ? ` (${pkg.origin.filter})` : ''}: ${bits.join(', ')}.`,
    createdAt:  now,
    model:      'none',
    promptHash: 'none',
    entities:   diff.entities.map(e => ({
      entityId:    e.entityId,
      ops:         e.ops,
      derivedFrom: { source: e.source },
      source:      `package:${e.source.site}${e.source.path}`,
      generatedAt: now,
      ...(e.note ? { note: e.note } : {}),
    })),
  }
}
