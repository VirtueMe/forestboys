<template>
  <RelationListEditor
    :parent-slug="slug"
    :entries="entries"
    :targets="targets"
    :strategy="OrganizationUnitsStrategy"
    label="Underavdelinger"
    add-label="+ Legg til underavdeling"
    empty-label="Ingen underavdelinger"
    search-placeholder="Søk avdeling…"
    picker-chip-aria="Bytt avdeling"
    validation-empty="Velg avdeling for alle rader før du lagrer."
    show-role
    role-scope="part-of"
    :show-dates="false"
    reorderable
  />
</template>

<script setup lang="ts">
/**
 * OrganizationUnitsEditor — admin editor for the org's PART_OF roster.
 * Wraps RelationListEditor with the strategy + role labels; the order is the
 * position in the list (the move panel). The parent owns the entries/targets
 * refs (loaded by useOrganizationData) and passes them through.
 */
import RelationListEditor from '@/components/relation/RelationListEditor.vue'
import { OrganizationUnitsStrategy } from '@/components/relation/strategies.ts'
import type { RelationEntry, RelationTarget } from '@/components/relation/RelationStrategy.ts'

defineProps<{
  slug:    string
  entries: RelationEntry[]
  targets: RelationTarget[]
}>()
</script>
