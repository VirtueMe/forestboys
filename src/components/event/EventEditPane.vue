<template>
  <div class="edit-pane">
    <EventScalarEditor
      ref="scalarEditor"
      :saved="event"
      :demote-blockers="demoteBlockers"
      @saved="out => emit('savedScalar', out)"
      @kind-flipped="kind => emit('kindFlipped', kind)"
    />

    <DescriptionEditor
      ref="descEditor"
      :saved="savedSections"
      :endpoint="`/api/admin/event/${encodeURIComponent(event.slug)}/sections`"
      @saved="sections => emit('savedSections', sections)"
    />

    <div class="relations-wrap">
      <EventRelations
        mode="edit"
        :slug="event.slug"
        :kind="event.kind"
        :data="data"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * EventEditPane — the admin "Rediger" pane on an Incident/Operation page.
 * Bundles ScalarEditor (name/date/kind) + DescriptionEditor (sections) +
 * EventRelations (people + hierarchy slots).
 *
 * Saves are emitted upward so the parent can refresh its data refs:
 * - `savedScalar`   — server response from PATCH /api/admin/event/:slug
 * - `kindFlipped`   — after a successful /kind PATCH (parent re-loads)
 * - `savedSections` — fresh Section[] after PATCH .../sections
 *
 * Editor template refs are exposed via defineExpose so a parent preview
 * overlay can read unsaved drafts and reflect them live.
 */
import { useTemplateRef } from 'vue'
import EventScalarEditor, { type EventScalarDraft, type DemoteBlockers } from './EventScalarEditor.vue'
import EventRelations, { type EventRelationsData } from './EventRelations.vue'
import DescriptionEditor from '@/components/DescriptionEditor.vue'
import type { Section } from '@/components/SectionsEditor.vue'
import type { EventKind, EventNode } from '@/composables/useEventData.ts'

interface ScalarSaved { name?: string; date?: string | null }

withDefaults(defineProps<{
  event:           EventNode
  savedSections:   Section[]
  data:            EventRelationsData
  demoteBlockers?: DemoteBlockers
}>(), {
  demoteBlockers: () => ({ orgs: [], units: [] }),
})

const emit = defineEmits<{
  savedScalar:   [out: ScalarSaved]
  kindFlipped:   [kind: EventKind]
  savedSections: [sections: Section[]]
}>()

const scalarEditor = useTemplateRef<{ draft: EventScalarDraft; dirty: boolean } | null>('scalarEditor')
const descEditor   = useTemplateRef<{ draft: Section[];        dirty: boolean } | null>('descEditor')

defineExpose({
  get scalarDraft(): EventScalarDraft | null { return scalarEditor.value?.draft ?? null },
  get scalarDirty(): boolean                 { return scalarEditor.value?.dirty ?? false },
  get descDraft():   Section[]               { return descEditor.value?.draft   ?? [] },
  get descDirty():   boolean                 { return descEditor.value?.dirty   ?? false },
})
</script>

<style scoped>
.edit-pane {
  background: var(--paper-raised);
  border-bottom: 1px solid var(--rule);
}
.relations-wrap {
  padding: 0 var(--space-md) var(--space-md);
}
</style>
