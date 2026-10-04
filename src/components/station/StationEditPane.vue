<template>
  <div class="edit-pane">
    <StationScalarEditor
      ref="scalarEditor"
      :slug="slug"
      :saved="station"
      :create-mode="createMode"
      @saved="out => emit('savedScalar', out)"
      @created="onScalarCreated"
    />

    <StationNamesEditor
      v-if="!createMode"
      ref="namesEditor"
      :slug="slug"
      :saved="savedNames"
      @saved="names => emit('savedNames', names)"
    />

    <DescriptionEditor
      ref="descEditor"
      :saved="savedSections"
      :endpoint="`/api/admin/station/${encodeURIComponent(slug)}/sections`"
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
      :strategy="StationStaysStrategy"
      label="Deltakere"
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
 * StationEditPane — admin "Rediger" pane for a Station. Bundles the
 * scalar editor, the other names (HAS_NAME) and the Beskrivelse description
 * editor (HAS_CONTENT).
 *
 * Deltakere edits the STATIONED_AT stays from the Station side (same
 * edges as the Person page's "Stasjonert på"). DEPARTED/ARRIVED_FROM_STATION
 * are managed from the Event side.
 */
import { useTemplateRef } from 'vue'
import StationScalarEditor, { type StationDraft } from './StationScalarEditor.vue'
import StationNamesEditor from './StationNamesEditor.vue'
import DescriptionEditor from '@/components/DescriptionEditor.vue'
import RelationListEditor from '@/components/relation/RelationListEditor.vue'
import { StationStaysStrategy, staySummaryExtra } from '@/components/relation/stayStrategies.ts'
import type { RelationEntry, RelationTarget } from '@/components/relation/RelationStrategy.ts'
import type { Section } from '@/components/SectionsEditor.vue'
import type { StationName, StationNode } from '@/composables/useStationData.ts'
import { authFetch } from '@/composables/useAuth.ts'
import { stashPendingDescription, type PendingDescription } from '@/composables/usePendingDescription.ts'

defineProps<{
  slug:           string
  station:        StationNode
  savedSections:  Section[]
  savedNames:     StationName[]
  /** STATIONED_AT stays at this place — mutated in place on save. */
  stayEntries:    RelationEntry[]
  stayTargets:    RelationTarget[]
  createMode?:    boolean
  pendingDescription?: PendingDescription | null
}>()

const emit = defineEmits<{
  savedScalar:   [out: Partial<StationNode>]
  savedSections: [sections: Section[]]
  savedNames:    [names: StationName[]]
  created:       [slug: string]
}>()

const scalarEditor = useTemplateRef<{ draft: StationDraft; dirty: boolean } | null>('scalarEditor')
const namesEditor  = useTemplateRef<{ dirty: boolean } | null>('namesEditor')
const descEditor   = useTemplateRef<{ draft: Section[];     dirty: boolean } | null>('descEditor')

defineExpose({
  get scalarDraft(): StationDraft | null { return scalarEditor.value?.draft ?? null },
  get scalarDirty(): boolean             { return scalarEditor.value?.dirty ?? false },
  get namesDirty():  boolean             { return namesEditor.value?.dirty ?? false },
  get descDraft():   Section[]           { return descEditor.value?.draft ?? [] },
  get descDirty():   boolean             { return descEditor.value?.dirty ?? false },
})

async function onScalarCreated(newSlug: string) {
  const sections = descEditor.value?.draft ?? []
  if (sections.length) {
    try {
      const res = await authFetch(`/api/admin/station/${encodeURIComponent(newSlug)}/sections`, {
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
          kind: 'station', slug: newSlug, sections,
          error: `Kunne ikke lagre beskrivelse: ${body.error ?? `HTTP ${res.status}`}`,
        })
      }
    } catch (e) {
      stashPendingDescription({
        kind: 'station', slug: newSlug, sections,
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
