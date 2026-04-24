<template>
  <ul v-if="ranks.length" class="rank-pills">
    <li v-for="r in ranks" :key="`${r.rankSlug}-${r.from}-${r.to}`" class="rank-pill">
      <span class="rank-name">{{ r.rankName || r.rankSlug }}</span>
      <span v-if="rankPeriod(r)" class="rank-period">{{ rankPeriod(r) }}</span>
    </li>
  </ul>
</template>

<script setup lang="ts">
/**
 * PersonRanksPreview — read-only pill list of held ranks. Sits in the
 * page identity strip above the View / Edit tabs.
 */
import type { HeldRank } from './types.ts'

defineProps<{ ranks: HeldRank[] }>()

function rankPeriod(r: HeldRank): string {
  if (r.from == null && r.to == null) return ''
  if (r.from != null && r.to != null && r.from === r.to) return String(r.from)
  return `${r.from ?? '?'}–${r.to ?? ''}`
}
</script>

<style scoped>
.rank-pills {
  list-style: none;
  margin: 0;
  padding: var(--space-sm) var(--space-md);
  background: var(--paper-raised);
  border-bottom: 1px solid var(--rule);
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}
.rank-pill {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm);
  background: var(--paper-sunken);
  border-radius: var(--radius-pill);
}
.rank-name   { font-family: var(--font-sans); font-size: var(--size-label); font-weight: 600; color: var(--ink); }
.rank-period { font-family: var(--font-mono); font-size: var(--size-caps); color: var(--muted); }
</style>
