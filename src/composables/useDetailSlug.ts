/**
 * The slug of the entity a detail page shows (#178): the one a preview panel was given, else the URL's `:slug`.
 *
 * A detail page fetches its entity from the URL (`/organization/<slug>`). In the review preview the entity is named by
 * the panel instead, and the window can sit on a page with no slug at all (the bundle page), so reading the route
 * there loads nothing. Every page and helper that needs the slug takes it from here and never from `route.params`.
 * An empty string means «no entity»: a page loads nothing for it.
 */
import { computed, inject, type ComputedRef } from 'vue'
import { useRoute } from 'vue-router'
import { ProposalPreviewSlugKey } from './proposalDataInjection.ts'

export function useDetailSlug(): ComputedRef<string> {
  const route         = useRoute()
  const previewedSlug = inject(ProposalPreviewSlugKey, null)
  return computed(() => previewedSlug ?? String(route.params.slug ?? ''))
}
