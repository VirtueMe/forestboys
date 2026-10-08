import { describe, expect, it, vi } from 'vitest'
import { createApp, reactive } from 'vue'
import { ProposalPreviewSlugKey } from './proposalDataInjection.ts'

// The route is replaced: what matters is which of the two slugs the detail pages read (#178).
const route = reactive<{ params: Record<string, string | undefined> }>({ params: {} })
vi.mock('vue-router', () => ({ useRoute: () => route }))

const { useDetailSlug } = await import('./useDetailSlug.ts')

/** The composable as a detail page inside a preview panel (`injected`) or on its own page (no `injected`) would run it. */
function slugOf(injected?: string) {
  const app = createApp({})
  if (injected !== undefined) app.provide(ProposalPreviewSlugKey, injected)
  return app.runWithContext(() => useDetailSlug())
}

describe('useDetailSlug', () => {
  it('is the slug the preview panel was given, also when the page has no slug in its URL', () => {
    route.params = {}                       // /admin/proposals/<bundleId>: the bundle page names no entity
    expect(slugOf('berit').value).toBe('berit')
  })

  it('prefers the panel\'s slug to the URL\'s: the entity previewed is not the page the window sits on', () => {
    route.params = { slug: 'kompani-linge' }
    expect(slugOf('berit').value).toBe('berit')
  })

  it('is the URL\'s slug on an ordinary detail page', () => {
    route.params = { slug: 'kompani-linge' }
    expect(slugOf().value).toBe('kompani-linge')
  })

  it('follows the URL when it changes (a detail page is reused from one entity to the next)', () => {
    route.params = { slug: 'a' }
    const slug = slugOf()
    route.params = { slug: 'b' }
    expect(slug.value).toBe('b')
  })

  it('is an empty string when there is no slug at all, so a page loads nothing', () => {
    route.params = {}
    expect(slugOf().value).toBe('')
  })
})
