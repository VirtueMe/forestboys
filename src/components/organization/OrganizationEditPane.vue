<template>
  <div class="edit-pane">
    <OrganizationScalarEditor
      ref="scalarEditor"
      :slug="slug"
      :saved="org"
      :create-mode="createMode"
      @saved="out => emit('savedScalar', out)"
      @created="slug => emit('created', slug)"
    />

    <template v-if="!createMode">
      <DescriptionEditor
        ref="descEditor"
        :saved="savedSections"
        :endpoint="`/api/admin/organization/${encodeURIComponent(slug)}/sections`"
        @saved="sections => emit('savedSections', sections)"
      />

      <OrganizationUnitsEditor
        :slug="slug"
        :entries="unitEntries"
        :targets="unitTargets"
      />

      <RelationListEditor
        :parent-slug="slug"
        :entries="operationEntries"
        :targets="operationTargets"
        :strategy="OrgOperationsStrategy"
        label="Operasjoner"
        add-label="+ Legg til operasjon"
        empty-label="Ingen operasjoner"
        search-placeholder="Søk operasjon…"
        picker-chip-aria="Bytt operasjon"
        validation-empty="Velg operasjon for alle rader før du lagrer."
        :show-dates="false"
        :show-description="false"
        create-label="+ Opprett ny operasjon"
        :create-href="createEventHref?.('operation')"
      />

      <RelationListEditor
        :parent-slug="slug"
        :entries="incidentEntries"
        :targets="incidentTargets"
        :strategy="OrgIncidentsStrategy"
        label="Hendelser"
        add-label="+ Legg til hendelse"
        empty-label="Ingen hendelser"
        search-placeholder="Søk hendelse…"
        picker-chip-aria="Bytt hendelse"
        validation-empty="Velg hendelse for alle rader før du lagrer."
        :show-dates="false"
        :show-description="false"
        create-label="+ Opprett ny hendelse"
        :create-href="createEventHref?.('incident')"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * OrganizationEditPane — admin "Rediger" pane on an Organization page.
 * Bundles the scalar editor, the Beskrivelse description editor, and
 * the Underavdelinger relation editor.
 *
 * Saves are emitted upward so the parent updates its data refs:
 * - `savedScalar` — server response from PATCH /api/admin/organization/:slug
 * - `savedSections` — fresh Section[] after PATCH .../sections
 * (Underavdelinger writes happen inside the relation editor and persist
 *  to the same `unitEntries` array passed in.)
 *
 * The two editor template refs are exposed via getter expose so the
 * parent's preview overlays (`displayName` etc., `previewSections`)
 * read the unsaved drafts and reflect them live in the header / preview.
 */
import { useTemplateRef } from 'vue'
import OrganizationScalarEditor, { type OrgDraft } from './OrganizationScalarEditor.vue'
import OrganizationUnitsEditor from './OrganizationUnitsEditor.vue'
import DescriptionEditor from '@/components/DescriptionEditor.vue'
import RelationListEditor from '@/components/relation/RelationListEditor.vue'
import { OrgOperationsStrategy, OrgIncidentsStrategy } from '@/components/relation/strategies.ts'
import type { Section } from '@/components/SectionsEditor.vue'
import type { OrgNode } from '@/composables/useOrganizationData.ts'
import type { RelationEntry, RelationTarget } from '@/components/relation/RelationStrategy.ts'

defineProps<{
  slug:              string
  org:               OrgNode
  savedSections:     Section[]
  unitEntries:       RelationEntry[]
  unitTargets:       RelationTarget[]
  operationEntries:  RelationEntry[]
  operationTargets:  RelationTarget[]
  incidentEntries:   RelationEntry[]
  incidentTargets:   RelationTarget[]
  /** When true, `slug` is the sentinel `new` and the scalar editor is
   *  in create mode. Description + relation editors are hidden (nothing
   *  to attach to yet). */
  createMode?:       boolean
  /** Returns the `/events/new?...#new` href used by the "+ Opprett ny"
   *  link inside the operation/incident pickers. */
  createEventHref?: (kind: 'incident' | 'operation') => string
}>()

const emit = defineEmits<{
  savedScalar:   [out: Partial<OrgNode>]
  savedSections: [sections: Section[]]
  created:       [slug: string]
}>()

const scalarEditor = useTemplateRef<{ draft: OrgDraft;  dirty: boolean } | null>('scalarEditor')
const descEditor   = useTemplateRef<{ draft: Section[]; dirty: boolean } | null>('descEditor')

defineExpose({
  get scalarDraft(): OrgDraft | null { return scalarEditor.value?.draft ?? null },
  get scalarDirty(): boolean         { return scalarEditor.value?.dirty ?? false },
  get descDraft():   Section[]       { return descEditor.value?.draft ?? [] },
  get descDirty():   boolean         { return descEditor.value?.dirty ?? false },
})
</script>

<style scoped>
.edit-pane {
  background: var(--paper-raised);
  border-bottom: 1px solid var(--rule);
  padding: var(--space-lg);
}
</style>
