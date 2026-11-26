/**
 * When an outline's slug may not change (#456). A bot job and a bundle made from an outline name it by slug in R2
 * (`outlineId`), which a rename does not rewrite: accepting such a bundle afterwards would not find the outline.
 * So the rename waits until nothing is open. Returns the message for the editor, or null when it may go ahead.
 */

import { listRecords } from './entity-records.ts'
import { bundleCounts } from '../../src/utils/bundleStatus.ts'
import type { BundleManifest } from './bundle-validate.ts'

export async function outlineRenameBlock(bucket: R2Bucket, slug: string): Promise<string | null> {
  const marker = await bucket.get(`proposals/pending-generations/${slug}.json`)
  if (marker) {
    const { expiresAt } = await marker.json<{ expiresAt?: string }>()
    if (expiresAt && Date.parse(expiresAt) > Date.now()) return 'En bot-jobb venter på denne siden. Vent til den er ferdig, eller avbryt den.'
  }

  // Bundles made from the outline (they leave this index when nothing in them is pending) …
  const index = await bucket.get(`proposals/by-outline/${slug}/index.json`)
  const made  = index ? (await index.json<{ bundleIds: string[] }>()).bundleIds : []
  for (const bundleId of made) {
    const manifest = await (await bucket.get(`proposals/bundles/${bundleId}/manifest.json`))?.json<BundleManifest>()
    if (manifest && bundleCounts(manifest.entities).pending > 0) return openMessage(bundleId)
  }

  // … and any other bundle that waits to change the outline itself.
  const pending = (await listRecords(bucket, `Outline:${slug}`)).find(r => r.status === 'pending')
  return pending ? openMessage(pending.bundleId) : null
}

const openMessage = (bundleId: string) => `Et forslag for denne siden er ikke ferdig behandlet (${bundleId}). Behandle det først.`
