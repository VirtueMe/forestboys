<template>
  <div class="edit-pane">
    <TransportScalarEditor
      ref="scalarEditor"
      :slug="slug"
      :saved="transport"
      :create-mode="createMode"
      @saved="out => emit('savedScalar', out)"
      @created="onScalarCreated"
    />

    <DescriptionEditor
      ref="descEditor"
      :saved="savedSections"
      :endpoint="`/api/admin/transport/${encodeURIComponent(slug)}/sections`"
      :hide-save="createMode"
      :initial-dirty-draft="pendingDescription?.sections"
      :external-error="pendingDescription?.error ?? null"
      @saved="sections => emit('savedSections', sections)"
    />

    <PhotoEditor v-if="!createMode" kind="transport" :slug="slug" />

    <RelationListEditor
      v-if="!createMode"
      :parent-slug="slug"
      :entries="crewEntries"
      :targets="crewTargets"
      :strategy="TransportCrewStrategy"
      label="Mannskap"
      add-label="+ Legg til person"
      empty-label="Ingen mannskap registrert"
      search-placeholder="Søk person…"
      picker-chip-aria="Bytt person"
      validation-empty="Velg person på alle rader før du lagrer."
      show-role
      role-scope="crew"
      :show-description="false"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * TransportEditPane — admin "Rediger" pane for a Transport. Bundles
 * the scalar editor, the Beskrivelse description editor (HAS_CONTENT) and
 * Mannskap (CREW_OF). USED is managed from the Event side.
 */
import { useTemplateRef } from 'vue'
import TransportScalarEditor, { type TransportDraft } from './TransportScalarEditor.vue'
import DescriptionEditor from '@/components/DescriptionEditor.vue'
import PhotoEditor from '@/components/PhotoEditor.vue'
import RelationListEditor from '@/components/relation/RelationListEditor.vue'
import { TransportCrewStrategy } from '@/components/relation/crewStrategies.ts'
import type { RelationEntry, RelationTarget } from '@/components/relation/RelationStrategy.ts'
import type { Section } from '@/components/SectionsEditor.vue'
import type { TransportNode } from '@/composables/useTransportData.ts'
import { authFetch } from '@/composables/useAuth.ts'
import { stashPendingDescription, type PendingDescription } from '@/composables/usePendingDescription.ts'

defineProps<{
  slug:           string
  transport:      TransportNode
  savedSections:  Section[]
  /** CREW_OF edges into this transport — mutated in place on save. */
  crewEntries:    RelationEntry[]
  crewTargets:    RelationTarget[]
  createMode?:    boolean
  pendingDescription?: PendingDescription | null
}>()

const emit = defineEmits<{
  savedScalar:   [out: Partial<TransportNode>]
  savedSections: [sections: Section[]]
  created:       [slug: string]
}>()

const scalarEditor = useTemplateRef<{ draft: TransportDraft; dirty: boolean } | null>('scalarEditor')
const descEditor   = useTemplateRef<{ draft: Section[];      dirty: boolean } | null>('descEditor')

defineExpose({
  get scalarDraft(): TransportDraft | null { return scalarEditor.value?.draft ?? null },
  get scalarDirty(): boolean               { return scalarEditor.value?.dirty ?? false },
  get descDraft():   Section[]             { return descEditor.value?.draft ?? [] },
  get descDirty():   boolean               { return descEditor.value?.dirty ?? false },
})

async function onScalarCreated(newSlug: string) {
  const sections = descEditor.value?.draft ?? []
  if (sections.length) {
    try {
      const res = await authFetch(`/api/admin/transport/${encodeURIComponent(newSlug)}/sections`, {
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
          kind: 'transport', slug: newSlug, sections,
          error: `Kunne ikke lagre beskrivelse: ${body.error ?? `HTTP ${res.status}`}`,
        })
      }
    } catch (e) {
      stashPendingDescription({
        kind: 'transport', slug: newSlug, sections,
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
