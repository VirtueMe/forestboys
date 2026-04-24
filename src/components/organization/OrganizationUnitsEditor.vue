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
    :role-options="PART_OF_ROLE_LABEL"
    :show-dates="false"
    :signature-extra="entrySignatureExtra"
    :summary-extra="entrySummaryExtra"
  >
    <template #extra-fields="{ entry }">
      <div class="unit-edge-row">
        <label class="unit-edge-label">Rekkefølge</label>
        <input
          class="edit-input edit-input-order"
          type="number"
          min="0"
          inputmode="numeric"
          :value="entry.order ?? ''"
          @input="entry.order = ($event.target as HTMLInputElement).value === '' ? null : Number(($event.target as HTMLInputElement).value)"
        />
      </div>
    </template>
  </RelationListEditor>
</template>

<script setup lang="ts">
/**
 * OrganizationUnitsEditor — admin editor for the org's PART_OF roster.
 * Wraps RelationListEditor with the strategy + role labels + the order
 * input slot. The parent owns the entries/targets refs (loaded by
 * useOrganizationData) and passes them through.
 */
import RelationListEditor from '@/components/relation/RelationListEditor.vue'
import { OrganizationUnitsStrategy, PART_OF_ROLE_LABEL } from '@/components/relation/strategies.ts'
import type { RelationEntry, RelationTarget } from '@/components/relation/RelationStrategy.ts'

defineProps<{
  slug:    string
  entries: RelationEntry[]
  targets: RelationTarget[]
}>()

function entrySignatureExtra(e: RelationEntry): string {
  return `${e.order ?? ''}`
}
function entrySummaryExtra(e: RelationEntry): string {
  return typeof e.order === 'number' ? `#${e.order}` : ''
}
</script>

<style scoped>
.unit-edge-row {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: var(--space-sm);
  align-items: center;
  margin-top: var(--space-sm);
}
.unit-edge-label {
  font-family: var(--font-sans);
  font-size: var(--size-label);
  font-weight: 500;
  color: var(--ink-soft);
}
.edit-input {
  width: 100%;
  padding: var(--space-sm) var(--space-md);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink);
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  box-sizing: border-box;
}
.edit-input-order {
  max-width: 100px;
  font-family: var(--font-mono);
  font-size: var(--size-mono);
}
</style>
