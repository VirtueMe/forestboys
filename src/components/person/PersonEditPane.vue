<template>
  <div class="edit-pane">
    <PersonScalarEditor
      ref="scalarEditor"
      :slug="person.slug"
      :saved="person"
      :create-mode="createMode"
      @saved="out => emit('savedScalar', out)"
      @created="onScalarCreated"
    />

    <DescriptionEditor
      ref="descEditor"
      :saved="savedSections"
      :endpoint="`/api/admin/person/${encodeURIComponent(person.slug)}/sections`"
      :hide-save="createMode"
      :initial-dirty-draft="pendingDescription?.sections"
      :external-error="pendingDescription?.error ?? null"
      @saved="sections => emit('savedSections', sections)"
    />

    <template v-if="!createMode">
      <PersonRanksEditor
        v-if="person.type === 'soldier'"
        :slug="person.slug"
        :saved="heldRanks"
        :options="rankOptions"
        @saved="ranks => emit('savedRanks', ranks)"
      />

      <PersonRelations
        mode="edit"
        :slug="person.slug"
        :data="data"
        :pending-expand-event="pendingExpandEvent"
        :create-event-href="createEventHref"
      />
    </template>
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
import { authFetch } from '@/composables/useAuth.ts'
import { stashPendingDescription, type PendingDescription } from '@/composables/usePendingDescription.ts'

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
  /** When true, `person.slug === 'new'`. Ranks + Relations are hidden;
   *  the Description editor stays visible (with hidden save bar) so the
   *  scalar Opprett can chain a sections PATCH after the entity is
   *  created. */
  createMode?:          boolean
  /** A description draft from a previous create attempt that failed to
   *  PATCH /sections. Seeded into the editor as dirty for retry. */
  pendingDescription?:  PendingDescription | null
  createEventHref?:    (kind: 'incident' | 'operation') => string
}>()

const emit = defineEmits<{
  savedScalar:   [out: ScalarSaved]
  savedRanks:    [ranks: HeldRank[]]
  savedSections: [sections: Section[]]
  created:       [slug: string]
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

/** Chained save during entity creation: after the scalar POST returns
 *  the new slug, persist the description draft (if non-empty) via the
 *  same /sections endpoint the editor would normally hit. On failure
 *  we stash the draft so the destination page can recover it — the
 *  navigation still happens because the entity itself exists. */
async function onScalarCreated(newSlug: string) {
  const sections = descEditor.value?.draft ?? []
  if (sections.length) {
    try {
      const res = await authFetch(`/api/admin/person/${encodeURIComponent(newSlug)}/sections`, {
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
          kind: 'person', slug: newSlug, sections,
          error: `Kunne ikke lagre beskrivelse: ${body.error ?? `HTTP ${res.status}`}`,
        })
      }
    } catch (e) {
      stashPendingDescription({
        kind: 'person', slug: newSlug, sections,
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
