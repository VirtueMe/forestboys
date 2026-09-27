<template>
  <div class="edit-pane">
    <UnitScalarEditor
      ref="scalarEditor"
      :slug="slug"
      :saved="unit"
      :create-mode="createMode"
      @saved="out => emit('savedScalar', out)"
      @created="onScalarCreated"
    />

    <DescriptionEditor
      ref="descEditor"
      :saved="savedSections"
      :endpoint="`/api/admin/unit/${encodeURIComponent(slug)}/sections`"
      :hide-save="createMode"
      :initial-dirty-draft="pendingDescription?.sections"
      :external-error="pendingDescription?.error ?? null"
      @saved="sections => emit('savedSections', sections)"
    />

    <template v-if="!createMode">
      <RelationListEditor
        :parent-slug="slug"
        :entries="personEntries"
        :targets="personTargets"
        :strategy="personStrategy"
        :label="isCourse ? 'Deltakere (rediger)' : 'Medlemmer (rediger)'"
        add-label="+ Legg til person"
        empty-label="Ingen personer knyttet"
        search-placeholder="Søk person…"
        picker-chip-aria="Bytt person"
        validation-empty="Velg person for alle oppføringer før du lagrer."
        :show-role="!isCourse"
        :role-scope="!isCourse ? 'membership' : undefined"
        :default-role="!isCourse ? 'member' : null"
        :show-passed="isCourse"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * UnitEditPane — admin "Rediger" pane for a Unit. Bundles the scalar
 * editor, the Beskrivelse description editor (HAS_CONTENT), and the
 * Medlemmer/Deltakere relation editor (skips when the Unit is a
 * training course, where it becomes Deltakere).
 *
 * Mirror of OrganizationEditPane. Member writes happen inside the
 * RelationListEditor and persist into the same `personEntries` array.
 */
import { computed, useTemplateRef } from 'vue'
import UnitScalarEditor, { type UnitDraft } from './UnitScalarEditor.vue'
import DescriptionEditor from '@/components/DescriptionEditor.vue'
import RelationListEditor from '@/components/relation/RelationListEditor.vue'
import { UnitMembersStrategy, UnitAttendeesStrategy } from '@/components/relation/strategies.ts'
import type { Section } from '@/components/SectionsEditor.vue'
import type { UnitNode } from '@/composables/useUnitData.ts'
import type { RelationEntry, RelationTarget } from '@/components/relation/RelationStrategy.ts'
import { authFetch } from '@/composables/useAuth.ts'
import { stashPendingDescription, type PendingDescription } from '@/composables/usePendingDescription.ts'

const props = defineProps<{
  slug:           string
  unit:           UnitNode
  savedSections:  Section[]
  personEntries:  RelationEntry[]
  personTargets:  RelationTarget[]
  createMode?:    boolean
  pendingDescription?: PendingDescription | null
}>()

const emit = defineEmits<{
  savedScalar:   [out: Partial<UnitNode>]
  savedSections: [sections: Section[]]
  created:       [slug: string]
}>()

const isCourse = computed(() => props.unit.type === 'course')
const personStrategy = computed(() => (isCourse.value ? UnitAttendeesStrategy : UnitMembersStrategy))


const scalarEditor = useTemplateRef<{ draft: UnitDraft; dirty: boolean } | null>('scalarEditor')
const descEditor   = useTemplateRef<{ draft: Section[]; dirty: boolean } | null>('descEditor')

defineExpose({
  get scalarDraft(): UnitDraft | null { return scalarEditor.value?.draft ?? null },
  get scalarDirty(): boolean          { return scalarEditor.value?.dirty ?? false },
  get descDraft():   Section[]        { return descEditor.value?.draft ?? [] },
  get descDirty():   boolean          { return descEditor.value?.dirty ?? false },
})

async function onScalarCreated(newSlug: string) {
  const sections = descEditor.value?.draft ?? []
  if (sections.length) {
    try {
      const res = await authFetch(`/api/admin/unit/${encodeURIComponent(newSlug)}/sections`, {
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
          kind: 'unit', slug: newSlug, sections,
          error: `Kunne ikke lagre beskrivelse: ${body.error ?? `HTTP ${res.status}`}`,
        })
      }
    } catch (e) {
      stashPendingDescription({
        kind: 'unit', slug: newSlug, sections,
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
