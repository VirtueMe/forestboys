<template>
  <section v-if="entries.length" class="section">
    <h3 class="section-heading">{{ label }} ({{ entries.length }})</h3>
    <div class="relation-list">
      <div v-for="e in entries" :key="e.targetSlug" class="relation-row">
        <RouterLink :to="strategy.targetRoute(e)" class="relation-link">{{ e.targetName }}</RouterLink>
        <span v-if="showRole && e.role" class="relation-role">
          {{ roleOptions?.[e.role] ?? e.role }}
        </span>
        <span v-if="periodOf(e)" class="member-period">{{ periodOf(e) }}</span>
        <span v-if="showPassed && e.passed === true"  class="passed-chip passed-chip--ok">Bestått</span>
        <span v-if="showPassed && e.passed === false" class="passed-chip passed-chip--no">Ikke bestått</span>
        <button
          v-if="e.hasDescription"
          class="info-marker"
          type="button"
          aria-label="Vis forklaring"
          @click="emit('open', e)"
        >
          i
        </button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { RouterLink } from 'vue-router'
import type { RelationEntry, RelationStrategy } from './RelationStrategy.ts'

withDefaults(defineProps<{
  entries:      RelationEntry[]
  strategy:     RelationStrategy
  label:        string
  showRole?:    boolean
  showPassed?:  boolean
  roleOptions?: Record<string, string>
}>(), {
  showRole:    false,
  showPassed:  false,
  roleOptions: undefined,
})

const emit = defineEmits<{ open: [entry: RelationEntry] }>()

function periodOf(e: RelationEntry): string {
  if (!e.startDate && !e.endDate) return ''
  return `${e.startDate ?? '?'}${e.endDate ? ` – ${e.endDate}` : ''}`
}
</script>

<style scoped>
.relation-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.relation-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}
.relation-link {
  font-size: 13px;
  color: var(--color-navy);
  text-decoration: none;
}
.relation-link:hover { text-decoration: underline; }

.relation-role {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
  padding: 1px 6px;
  border: 1px solid var(--color-border-mid);
  border-radius: 3px;
}

.member-period {
  font-size: 11px;
  color: var(--color-muted);
  font-variant-numeric: tabular-nums;
}

.info-marker {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid var(--color-border-mid);
  background: var(--color-surface);
  color: var(--color-muted);
  font-size: 11px;
  font-weight: 700;
  font-style: italic;
  line-height: 1;
  cursor: pointer;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.1s, border-color 0.1s, color 0.1s;
  -webkit-tap-highlight-color: transparent;
  margin-left: auto;
}
.info-marker:hover,
.info-marker[aria-expanded="true"] {
  background: var(--color-navy);
  border-color: var(--color-navy);
  color: #fff;
}

.passed-chip {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 10px;
  border: 1px solid transparent;
}
.passed-chip--ok { background: #ecfdf5; color: #047857; border-color: #a7f3d0; }
.passed-chip--no { background: #fef2f2; color: #b91c1c; border-color: #fecaca; }
</style>
