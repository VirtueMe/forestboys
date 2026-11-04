<template>
  <RelationListEditor
    :parent-slug="slug"
    :entries="entries"
    :targets="targets"
    :strategy="OutlineMentionsStrategy"
    label="Omtalte personer (rediger)"
    add-label="+ Legg til person"
    empty-label="Ingen personer knyttet"
    search-placeholder="Søk person…"
    picker-chip-aria="Bytt person"
    validation-empty="Velg person for alle oppføringer før du lagrer."
    :show-dates="false"
    :show-description="false"
    @saved="emit('saved')"
  />
</template>

<script setup lang="ts">
/**
 * OutlinePeopleEditor — admin editor for the people an outline mentions (MENTIONS). Wraps RelationListEditor with the
 * strategy and the Norwegian labels; a plain person link, so no role, dates or note. The page owns the entries/targets
 * refs and passes them through, as the organisation's unit editor does.
 */
import RelationListEditor from '@/components/relation/RelationListEditor.vue'
import { OutlineMentionsStrategy } from '@/components/relation/strategies.ts'
import type { RelationEntry, RelationTarget } from '@/components/relation/RelationStrategy.ts'

defineProps<{
  slug:    string
  entries: RelationEntry[]
  targets: RelationTarget[]
}>()

const emit = defineEmits<{ saved: [] }>()
</script>
