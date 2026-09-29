<template>
  <RelationListEditor
    :parent-slug="slug"
    :entries="entries"
    :targets="targets"
    :strategy="RankHistoryStrategy"
    label="Gradshistorikk"
    add-label="+ Legg til grad"
    empty-label="Ingen historikk"
    search-placeholder="Søk grad…"
    picker-chip-aria="Bytt grad"
    validation-empty="Velg grad for alle oppføringer før du lagrer."
    show-sources
    :signature-extra="e => String(!!e.acting)"
    :summary-extra="actingLabel"
    @saved="emit('saved')"
  >
    <template #extra-fields="{ entry }">
      <label class="acting-toggle">
        <input v-model="entry.acting" type="checkbox" />
        Fungerende
      </label>
    </template>
  </RelationListEditor>
</template>

<script setup lang="ts">
/**
 * PersonRankHistoryEditor — the person's rank history (docs/PERSON-RANKS.md
 * R2, R3, R7): rank, from / to, acting, sources (what proves it — a
 * document, a page) and a note per entry.
 *
 * R7 — a new rank closes the open one. When a row added in this editing
 * session gets a `from` date and is the latest of its kind (real or
 * acting), the open row of the same kind gets `to` = that date. It runs
 * per kind because an acting rank runs alongside the real one. A row
 * dated before an existing one of its kind (filling in history) closes
 * nothing. The closing is visible before saving, follows later edits of
 * the new row's date or kind, and is undone if the new row is removed —
 * unless the closed row's `to` was changed by hand in between.
 */
import { watch } from 'vue'
import RelationListEditor from '@/components/relation/RelationListEditor.vue'
import { RankHistoryStrategy, actingLabel } from '@/components/relation/rankStrategies.ts'
import type { RelationEntry, RelationTarget } from '@/components/relation/RelationStrategy.ts'
import { PARTIAL_DATE_RE, comparePartial } from '@/utils/period.ts'

const props = defineProps<{
  slug:    string
  entries: RelationEntry[]
  targets: RelationTarget[]
}>()

const emit = defineEmits<{ saved: [] }>()

/** New row → the row it closed, the `to` it wrote, and the kind it closed for. */
const closed = new Map<RelationEntry, { entry: RelationEntry; value: string; acting: boolean }>()

function undo(row: RelationEntry) {
  const c = closed.get(row)
  if (c && c.entry.endDate === c.value) c.entry.endDate = null
  closed.delete(row)
}

function closeFor(row: RelationEntry) {
  const from = row.startDate
  if (!from || !PARTIAL_DATE_RE.test(from)) return
  const acting = !!row.acting
  const sameKind = props.entries.filter(o => o !== row && !!o.acting === acting)
  // Filling in history: something of this kind starts at or after it.
  if (sameKind.some(o => o.startDate && comparePartial(o.startDate, from) >= 0)) return
  const open = sameKind
    .filter(o => !o.endDate && o.startDate && comparePartial(o.startDate, from) < 0)
    .sort((a, b) => comparePartial(b.startDate!, a.startDate!))[0]
  if (!open) return
  open.endDate = from
  closed.set(row, { entry: open, value: from, acting })
}

watch(
  () => props.entries.map(e => [e, e.startDate, !!e.acting] as const),
  () => {
    for (const row of [...closed.keys()]) if (!props.entries.includes(row)) undo(row)
    for (const row of props.entries) {
      if (row.edgeId) continue // only rows added in this session
      const c = closed.get(row)
      if (c) {
        // Follow the new row's date; re-evaluate if its kind or date no longer fits.
        if (c.acting !== !!row.acting || !row.startDate || !PARTIAL_DATE_RE.test(row.startDate)) undo(row)
        else if (c.entry.endDate === c.value && row.startDate !== c.value) {
          c.entry.endDate = row.startDate
          c.value = row.startDate
          continue
        } else continue
      }
      closeFor(row)
    }
  },
)
</script>

<style scoped>
.acting-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  margin-top: var(--space-sm);
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--ink-soft);
}
</style>
