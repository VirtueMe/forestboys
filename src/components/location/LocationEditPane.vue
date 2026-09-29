<template>
  <div class="edit-pane">
    <LocationScalarEditor
      ref="scalarEditor"
      :slug="slug"
      :saved="location"
      :create-mode="createMode"
      @saved="out => emit('savedScalar', out)"
      @created="onScalarCreated"
    />

    <DescriptionEditor
      ref="descEditor"
      :saved="savedSections"
      :endpoint="`/api/admin/location/${encodeURIComponent(slug)}/sections`"
      :hide-save="createMode"
      :initial-dirty-draft="pendingDescription?.sections"
      :external-error="pendingDescription?.error ?? null"
      @saved="sections => emit('savedSections', sections)"
    />

    <RelationListEditor
      v-if="!createMode"
      :parent-slug="slug"
      :entries="stayEntries"
      :targets="stayTargets"
      :strategy="LocationStaysStrategy"
      label="Personer"
      add-label="+ Legg til person"
      empty-label="Ingen personer knyttet"
      search-placeholder="Søk person…"
      picker-chip-aria="Bytt person"
      validation-empty="Velg person for alle opphold før du lagrer."
      show-role
      role-scope="stationed"
      default-role="stationed"
      show-sources
      :summary-extra="staySummaryExtra"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * LocationEditPane — admin "Rediger" pane for a Location. Bundles the
 * scalar editor (name + coordinates + map picker) and the Beskrivelse
 * description editor (HAS_CONTENT).
 *
 * Personer edits the STATIONED_AT stays from the place side (same edges
 * as the Person page's "Stasjonert på"). Events attach to a Location
 * from the Event side (AT / FROM / TO slots).
 */
import { useTemplateRef } from 'vue'
import LocationScalarEditor, { type LocationDraft } from './LocationScalarEditor.vue'
import DescriptionEditor from '@/components/DescriptionEditor.vue'
import RelationListEditor from '@/components/relation/RelationListEditor.vue'
import { LocationStaysStrategy, staySummaryExtra } from '@/components/relation/stayStrategies.ts'
import type { RelationEntry, RelationTarget } from '@/components/relation/RelationStrategy.ts'
import type { Section } from '@/components/SectionsEditor.vue'
import type { LocationNode } from '@/composables/useLocationData.ts'
import { authFetch } from '@/composables/useAuth.ts'
import { stashPendingDescription, type PendingDescription } from '@/composables/usePendingDescription.ts'

defineProps<{
  slug:           string
  location:       LocationNode
  savedSections:  Section[]
  /** STATIONED_AT stays at this place — mutated in place on save. */
  stayEntries:    RelationEntry[]
  stayTargets:    RelationTarget[]
  createMode?:    boolean
  pendingDescription?: PendingDescription | null
}>()

const emit = defineEmits<{
  savedScalar:   [out: Partial<LocationNode>]
  savedSections: [sections: Section[]]
  created:       [slug: string]
}>()

const scalarEditor = useTemplateRef<{ draft: LocationDraft; dirty: boolean } | null>('scalarEditor')
const descEditor   = useTemplateRef<{ draft: Section[];     dirty: boolean } | null>('descEditor')

defineExpose({
  get scalarDraft(): LocationDraft | null { return scalarEditor.value?.draft ?? null },
  get scalarDirty(): boolean             { return scalarEditor.value?.dirty ?? false },
  get descDraft():   Section[]           { return descEditor.value?.draft ?? [] },
  get descDirty():   boolean             { return descEditor.value?.dirty ?? false },
})

async function onScalarCreated(newSlug: string) {
  const sections = descEditor.value?.draft ?? []
  if (sections.length) {
    try {
      const res = await authFetch(`/api/admin/location/${encodeURIComponent(newSlug)}/sections`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          sections: sections
            .slice()
            .sort((a, b) => a.order - b.order)
            .map(s => ({
              order:         s.order,
              content:       s.content,
              citations:     s.citations.map(c => ({ inline: c.inline, sourceId: c.source.id })),
              sourcedFromId: s.sourcedFrom?.id ?? null,
            })),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        stashPendingDescription({
          kind: 'location', slug: newSlug, sections,
          error: `Kunne ikke lagre beskrivelse: ${body.error ?? `HTTP ${res.status}`}`,
        })
      }
    } catch (e) {
      stashPendingDescription({
        kind: 'location', slug: newSlug, sections,
        error: `Kunne ikke lagre beskrivelse: ${(e as Error).message}`,
      })
    }
  }
  emit('created', newSlug)
}
</script>

<style scoped>
.edit-pane {
  background: var(--paper-raised);
  border-bottom: 1px solid var(--rule);
  padding: var(--space-lg);
}
</style>
