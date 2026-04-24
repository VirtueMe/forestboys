<template>
  <div class="edit-pane">
    <PersonScalarEditor
      ref="scalarEditor"
      :slug="person.slug"
      :saved="person"
      @saved="out => emit('savedScalar', out)"
    />

    <PersonRanksEditor
      v-if="person.type === 'soldier'"
      :slug="person.slug"
      :saved="heldRanks"
      :options="rankOptions"
      @saved="ranks => emit('savedRanks', ranks)"
    />

    <DescriptionEditor
      ref="descEditor"
      :saved="savedSections"
      :endpoint="`/api/admin/person/${encodeURIComponent(person.slug)}/sections`"
      @saved="sections => emit('savedSections', sections)"
    />

    <PersonRelations
      mode="edit"
      :slug="person.slug"
      :data="data"
      :pending-expand-event="pendingExpandEvent"
      :create-event-href="createEventHref"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * PersonEditPane — the admin "Rediger" pane on a person page. Bundles the
 * three editors (Grunnleggende, Beskrivelse, the four Relation lists).
 *
 * Saves are emitted upward so the parent can update its data refs:
 * - `savedScalar` — server response from PATCH /api/admin/person/:slug
 * - `savedSections` — fresh Section[] after PATCH .../sections
 *
 * The two editor template refs are exposed via defineExpose so the parent's
 * preview-overlay computeds (`person`, `previewSections`) can read the
 * unsaved drafts and reflect them live in the Forhåndsvisning tab.
 */
import { useTemplateRef } from 'vue'
import PersonScalarEditor, { type ScalarDraft } from './PersonScalarEditor.vue'
import PersonRanksEditor from './PersonRanksEditor.vue'
import DescriptionEditor from '@/components/DescriptionEditor.vue'
import PersonRelations, { type PersonRelationsData } from './PersonRelations.vue'
import type { Section } from '@/components/SectionsEditor.vue'
import type { Neo4jPerson } from '@/composables/usePersonData.ts'
import type { HeldRank, RankOption, PersonType } from './types.ts'

interface ScalarSaved {
  canonicalName?: string
  secretName?:    string | null
  birthYear?:     number | null
  home?:          string | null
  type?:          PersonType
}

defineProps<{
  person:               Neo4jPerson
  heldRanks:            HeldRank[]
  rankOptions:          RankOption[]
  savedSections:        Section[]
  data:                 PersonRelationsData
  pendingExpandEvent?:  string | null
  createEventHref?:    (kind: 'incident' | 'operation') => string
}>()

const emit = defineEmits<{
  savedScalar:   [out: ScalarSaved]
  savedRanks:    [ranks: HeldRank[]]
  savedSections: [sections: Section[]]
}>()

const scalarEditor = useTemplateRef<{ draft: ScalarDraft; dirty: boolean } | null>('scalarEditor')
const descEditor   = useTemplateRef<{ draft: Section[];   dirty: boolean } | null>('descEditor')

/** Flat getters expose the editor drafts so the parent's preview overlay
 *  computeds (`person`, `previewSections`) read them without chaining
 *  through nested template refs. Reactive: each getter access tracks the
 *  underlying templateRef's `.value`. */
defineExpose({
  get scalarDraft(): ScalarDraft | null { return scalarEditor.value?.draft ?? null },
  get scalarDirty(): boolean            { return scalarEditor.value?.dirty ?? false },
  get descDraft():   Section[]          { return descEditor.value?.draft ?? [] },
  get descDirty():   boolean            { return descEditor.value?.dirty ?? false },
})
</script>

<style scoped>
.edit-pane {
  background: var(--paper-raised);
  border-bottom: 1px solid var(--rule);
  padding: var(--space-lg);
}
</style>
