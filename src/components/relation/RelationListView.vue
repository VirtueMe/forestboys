<template>
  <component :is="headless ? 'div' : 'section'" v-if="entries.length" :class="{ section: !headless }">
    <h3 v-if="!headless" class="section-heading">{{ label }} ({{ entries.length }})</h3>
    <div class="relation-list">
      <div
        v-for="(e, i) in entries"
        :key="e.edgeId ?? `${e.targetSlug}:${i}`"
        class="relation-row"
        :class="{
          'relation-row--ghost': !!e.pendingFromBundle,
          'relation-row--removed': !!e.pendingRemoval,
        }"
      >
        <RouterLink :to="strategy.targetRoute(e)" class="relation-link">{{ e.targetName }}</RouterLink>
        <span v-if="e.pendingFromBundle" class="pending-chip pending-chip--add">Foreslått</span>
        <span v-if="e.pendingRemoval" class="pending-chip pending-chip--del">Vil fjernes</span>
        <span v-if="showRole && e.role" class="relation-role">
          <RoleLabel :role-key="e.role" />
        </span>
        <span v-if="periodOf(e)" class="member-period">{{ periodOf(e) }}</span>
        <span v-if="showPassed && e.passed === true" class="passed-chip passed-chip--ok">Bestått</span>
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
  </component>
</template>

<script setup lang="ts">
import { RouterLink } from 'vue-router'
import RoleLabel from '@/components/role/RoleLabel.vue'
import { formatPeriod } from '@/utils/period.ts'
import type { RelationEntry, RelationStrategy } from './RelationStrategy.ts'

withDefaults(defineProps<{
  entries:      RelationEntry[]
  strategy:     RelationStrategy
  label:        string
  showRole?:    boolean
  showPassed?:  boolean
  /** Rows only — the caller renders its own heading (e.g. a <details> summary). */
  headless?:    boolean
}>(), {
  showRole:    false,
  showPassed:  false,
  headless:    false,
})

const emit = defineEmits<{ open: [entry: RelationEntry] }>()

function periodOf(e: RelationEntry): string {
  return formatPeriod(e.startDate, e.endDate)
}
</script>

<style scoped>
.relation-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
.relation-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-xs) 0;
}
.relation-link {
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink);
  text-decoration: underline;
  text-decoration-color: var(--rule);
  text-underline-offset: 3px;
}
.relation-link:hover {
  color: var(--faded-red);
  text-decoration-color: var(--faded-red);
}

.relation-role {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--ink-soft);
  padding: var(--space-xs) var(--space-sm);
  background: var(--paper-sunken);
  border-radius: var(--radius-pill);
}

.member-period {
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.info-marker {
  width: 20px;
  height: 20px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--rule);
  background: var(--paper-raised);
  color: var(--ink-soft);
  font-family: var(--font-serif);
  font-size: var(--size-label);
  font-weight: 600;
  font-style: italic;
  line-height: 1;
  cursor: pointer;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 120ms ease-out, border-color 120ms ease-out, color 120ms ease-out;
  -webkit-tap-highlight-color: transparent;
  margin-left: auto;
}
.info-marker:hover,
.info-marker[aria-expanded="true"] {
  background: var(--faded-red);
  border-color: var(--faded-red);
  color: var(--paper);
}

.passed-chip {
  display: inline-flex;
  align-items: center;
  padding: var(--space-xs) var(--space-sm);
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  border-radius: var(--radius-pill);
  border: 1px solid transparent;
}
.passed-chip--ok { background: var(--moss); color: var(--paper); }
.passed-chip--no { background: var(--paper-sunken); color: var(--danger); border-color: var(--rule); }

/* Proposal-preview: dashed-border + desaturated chip for entries
   fabricated from an add-edge op; strikethrough + muted for entries a
   remove-edge op would drop on accept. Live consumers never see these
   modifiers (the fields default to undefined in fetchEntries output). */
.relation-row--ghost {
  border: 1px dashed var(--rule);
  border-radius: var(--radius-md);
  padding: var(--space-xs) var(--space-sm);
  background: var(--paper-sunken);
  opacity: 0.85;
}
.relation-row--removed .relation-link {
  text-decoration: line-through;
  color: var(--muted);
}
.relation-row--removed { opacity: 0.6; }

.pending-chip {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-pill);
  border: 1px dashed var(--rule);
}
.pending-chip--add { color: var(--moss); }
.pending-chip--del { color: var(--danger); }
</style>
