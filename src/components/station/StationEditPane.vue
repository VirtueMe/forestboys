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

    <DescriptionEditor
      ref="descEditor"
      :saved="savedSections"
      :endpoint="`/api/admin/station/${encodeURIComponent(slug)}/sections`"
      :hide-save="createMode"
      :initial-dirty-draft="pendingDescription?.sections"
      :external-error="pendingDescription?.error ?? null"
      @saved="sections => emit('savedSections', sections)"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * StationEditPane — admin "Rediger" pane for a Station. Bundles the
 * scalar editor and the Beskrivelse description editor (HAS_CONTENT).
 *
 * No relation editors yet — Station relations (STATIONED_AT,
 * DEPARTED/ARRIVED_FROM_STATION) are managed from the other side
 * (Person and Event detail pages). When that changes, add them here
 * as RelationListEditor instances mirroring the Org/Unit pattern.
 */
import { useTemplateRef } from 'vue'
import StationScalarEditor, { type StationDraft } from './StationScalarEditor.vue'
import DescriptionEditor from '@/components/DescriptionEditor.vue'
import type { Section } from '@/components/SectionsEditor.vue'
import type { StationNode } from '@/composables/useStationData.ts'
import { authFetch } from '@/composables/useAuth.ts'
import { stashPendingDescription, type PendingDescription } from '@/composables/usePendingDescription.ts'

defineProps<{
  slug:           string
  station:        StationNode
  savedSections:  Section[]
  createMode?:    boolean
  pendingDescription?: PendingDescription | null
}>()

const emit = defineEmits<{
  savedScalar:   [out: Partial<StationNode>]
  savedSections: [sections: Section[]]
  created:       [slug: string]
}>()

const scalarEditor = useTemplateRef<{ draft: StationDraft; dirty: boolean } | null>('scalarEditor')
const descEditor   = useTemplateRef<{ draft: Section[];     dirty: boolean } | null>('descEditor')

defineExpose({
  get scalarDraft(): StationDraft | null { return scalarEditor.value?.draft ?? null },
  get scalarDirty(): boolean             { return scalarEditor.value?.dirty ?? false },
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
