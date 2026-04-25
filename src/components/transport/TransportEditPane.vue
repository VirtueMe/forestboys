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
  </div>
</template>

<script setup lang="ts">
/**
 * TransportEditPane — admin "Rediger" pane for a Transport. Bundles
 * the scalar editor and the Beskrivelse description editor (HAS_CONTENT).
 *
 * No relation editors yet — Transport relations (CREW_OF, USED) are
 * managed from the other side (Person and Event detail pages). When
 * that changes, add them here as RelationListEditor instances.
 */
import { useTemplateRef } from 'vue'
import TransportScalarEditor, { type TransportDraft } from './TransportScalarEditor.vue'
import DescriptionEditor from '@/components/DescriptionEditor.vue'
import type { Section } from '@/components/SectionsEditor.vue'
import type { TransportNode } from '@/composables/useTransportData.ts'
import { authFetch } from '@/composables/useAuth.ts'
import { stashPendingDescription, type PendingDescription } from '@/composables/usePendingDescription.ts'

defineProps<{
  slug:           string
  transport:      TransportNode
  savedSections:  Section[]
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
