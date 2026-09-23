<template>
  <div class="edit-pane">
    <EquipmentScalarEditor
      ref="scalarEditor"
      :slug="slug"
      :saved="equipment"
      :create-mode="createMode"
      @saved="out => emit('savedScalar', out)"
      @created="onScalarCreated"
    />

    <RelationListEditor
      v-if="!createMode"
      :parent-slug="slug"
      :entries="paired.entries"
      :targets="paired.targets"
      :strategy="EquipmentPairedStrategy"
      label="Paret med"
      add-label="+ Legg til utstyr"
      empty-label="Ikke paret med annet utstyr"
      search-placeholder="Søk utstyr…"
      picker-chip-aria="Bytt utstyr"
      validation-empty="Velg utstyr for alle oppføringer før du lagrer."
      :show-dates="false"
      :show-description="false"
    />

    <DescriptionEditor
      ref="descEditor"
      :saved="savedSections"
      :endpoint="`/api/admin/equipment/${encodeURIComponent(slug)}/sections`"
      :hide-save="createMode"
      :initial-dirty-draft="pendingDescription?.sections"
      :external-error="pendingDescription?.error ?? null"
      @saved="sections => emit('savedSections', sections)"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * EquipmentEditPane — admin "Rediger" pane for an EquipmentType.
 * Bundles the scalar editor, the Paret med (PAIRED_WITH) relation
 * editor and the Beskrivelse description editor (HAS_CONTENT).
 *
 * Paret med is hidden in create mode — pair after the node exists.
 */
import { useTemplateRef } from 'vue'
import EquipmentScalarEditor, { type EquipmentDraft } from './EquipmentScalarEditor.vue'
import DescriptionEditor from '@/components/DescriptionEditor.vue'
import RelationListEditor from '@/components/relation/RelationListEditor.vue'
import { EquipmentPairedStrategy } from '@/components/relation/strategies.ts'
import type { RelationEntry, RelationTarget } from '@/components/relation/RelationStrategy.ts'
import type { Section } from '@/components/SectionsEditor.vue'
import type { EquipmentNode } from '@/composables/useEquipmentData.ts'
import { authFetch } from '@/composables/useAuth.ts'
import { stashPendingDescription, type PendingDescription } from '@/composables/usePendingDescription.ts'

defineProps<{
  slug:           string
  equipment:      EquipmentNode
  paired:         { entries: RelationEntry[]; targets: RelationTarget[] }
  savedSections:  Section[]
  createMode?:    boolean
  pendingDescription?: PendingDescription | null
}>()

const emit = defineEmits<{
  savedScalar:   [out: Partial<EquipmentNode>]
  savedSections: [sections: Section[]]
  created:       [slug: string]
}>()

const scalarEditor = useTemplateRef<{ draft: EquipmentDraft; dirty: boolean } | null>('scalarEditor')
const descEditor   = useTemplateRef<{ draft: Section[];     dirty: boolean } | null>('descEditor')

defineExpose({
  get scalarDraft(): EquipmentDraft | null { return scalarEditor.value?.draft ?? null },
  get scalarDirty(): boolean             { return scalarEditor.value?.dirty ?? false },
  get descDraft():   Section[]           { return descEditor.value?.draft ?? [] },
  get descDirty():   boolean             { return descEditor.value?.dirty ?? false },
})

async function onScalarCreated(newSlug: string) {
  const sections = descEditor.value?.draft ?? []
  if (sections.length) {
    try {
      const res = await authFetch(`/api/admin/equipment/${encodeURIComponent(newSlug)}/sections`, {
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
          kind: 'equipment', slug: newSlug, sections,
          error: `Kunne ikke lagre beskrivelse: ${body.error ?? `HTTP ${res.status}`}`,
        })
      }
    } catch (e) {
      stashPendingDescription({
        kind: 'equipment', slug: newSlug, sections,
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
