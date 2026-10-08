/**
 * The pages and helpers that fetch an entity for the detail pages get its slug from `useDetailSlug()`, not from
 * `route.params.slug` (#178). The preview window on a bundle page (`/admin/proposals/<bundleId>`) has no slug in its
 * URL, so a page that reads the route there loads nothing and says «ikke funnet». The panel provides the slug it was
 * given; `useDetailSlug` returns that, else the route's.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '..', 'src')
const FILES = [
  'components/DetailPage.vue',
  'composables/useDetailCreateMode.ts',
  'pages/OutlineDetail.vue',
  'pages/EventDetail.vue',
]

describe('detail slug convention', () => {
  for (const file of FILES) {
    it(`${file} does not read route.params.slug itself`, () => {
      expect(readFileSync(join(SRC, file), 'utf8')).not.toMatch(/route\.params\.slug/)
    })
  }

  it('the panel provides the slug it was given', () => {
    expect(readFileSync(join(SRC, 'components/EntityPreviewPanel.vue'), 'utf8')).toMatch(/provide\(ProposalPreviewSlugKey,\s*props\.slug\)/)
  })
})
