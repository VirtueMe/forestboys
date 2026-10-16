<template>
  <component :is="headless ? 'div' : 'section'" v-if="entries.length" :class="{ section: !headless }">
    <h2 v-if="!headless" class="section-heading">{{ label }} ({{ entries.length }})</h2>
    <CollapsibleList :count="entries.length" :label="label">
      <div class="relation-list" :class="{ 'relation-list--events': eventDates }">
        <div
          v-for="(e, i) in entries"
          :key="e.edgeId ?? `${e.targetSlug}:${i}`"
          class="relation-row"
          :class="{
            'relation-row--ghost': !!e.pendingFromBundle,
            'relation-row--removed': !!e.pendingRemoval,
          }"
        >
          <!-- An event's date is its first column, as in EventList (#284). -->
          <span v-if="eventDates" class="event-date" :class="{ undated: !periodOf(e) }">{{ periodOf(e) || '–' }}</span>
          <span class="relation-main">
            <RouterLink :to="strategy.targetRoute(e)" class="relation-link">{{ e.targetName }}</RouterLink>
            <!-- Everything after the name: a column of its own, so the chips line up (#291). -->
            <span class="relation-extras">
              <span v-if="e.pendingFromBundle" class="pending-chip pending-chip--add">Foreslått</span>
              <span v-if="e.pendingRemoval" class="pending-chip pending-chip--del">Vil fjernes</span>
              <span v-if="kindLabel?.(e)" class="relation-kind">{{ kindLabel(e) }}</span>
              <span v-if="showRole && e.role" class="relation-role">
                <RoleLabel :role-key="e.role" />
              </span>
              <span v-if="!eventDates && periodOf(e)" class="member-period">{{ periodOf(e) }}</span>
              <span v-if="showPassed && e.passed === true" class="passed-chip passed-chip--ok">Bestått</span>
              <span v-if="showPassed && e.passed === false" class="passed-chip passed-chip--no">Ikke bestått</span>
              <SourceRef v-if="e.sourceRefs?.length" :refs="e.sourceRefs" />
              <button
                v-if="e.hasDescription"
                class="info-marker"
                type="button"
                aria-label="Vis forklaring"
                @click="emit('open', e)"
              >
                i
              </button>
            </span>
          </span>
        </div>
      </div>
    </CollapsibleList>
  </component>
</template>

<script setup lang="ts">
import { RouterLink } from 'vue-router'
import RoleLabel from '@/components/role/RoleLabel.vue'
import CollapsibleList from '@/components/CollapsibleList.vue'
import SourceRef from '@/components/SourceRef.vue'
import { formatEventPeriod, formatPeriod } from '@/utils/period.ts'
import type { RelationEntry, RelationStrategy } from './RelationStrategy.ts'

const props = withDefaults(defineProps<{
  entries:      RelationEntry[]
  strategy:     RelationStrategy
  label:        string
  showRole?:    boolean
  showPassed?:  boolean
  /** Rows only — the caller renders its own heading (e.g. a <details> summary). */
  headless?:    boolean
  /** A short tag before the role, for a list that mixes kinds of rows (e.g. «Kurs»). */
  kindLabel?:   (e: RelationEntry) => string | null
  /** The dates are when an event happened, not a period of membership: «12.–15. april 1945», no open dash (#284). */
  eventDates?:  boolean
}>(), {
  showRole:    false,
  showPassed:  false,
  headless:    false,
  kindLabel:   undefined,
  eventDates:  false,
})

const emit = defineEmits<{ open: [entry: RelationEntry] }>()

function periodOf(e: RelationEntry): string {
  return props.eventDates ? formatEventPeriod(e.startDate, e.endDate) : formatPeriod(e.startDate, e.endDate)
}
</script>

<style scoped>
/* Name | the rest: the name column is as wide as the longest name (at most 65%, then a name wraps), so the chips after
   it line up in a column of their own (#291). */
.relation-list {
  display: grid;
  grid-template-columns: fit-content(65%) minmax(0, 1fr);
  gap: var(--space-xs) 0;
}
.relation-row {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: subgrid;
  align-items: center;
  column-gap: var(--space-md);
  padding: var(--space-xs) 0;
}
.relation-extras { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-sm); min-width: 0; }
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

.relation-kind {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--ink-soft);
  padding: var(--space-xs) var(--space-sm);
  border: 1px solid var(--rule);
  border-radius: var(--radius-pill);
}

/* With eventDates: the date in a first column at least 9rem wide, the same as EventList. */
.relation-list--events {
  display: grid;
  grid-template-columns: minmax(9rem, max-content) minmax(0, 1fr);
  gap: var(--space-xs) 0;
}
.relation-list--events .relation-row {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: subgrid;
  align-items: baseline;
  column-gap: var(--space-md);
}
.event-date {
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 600;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.event-date.undated { color: var(--muted); font-weight: 400; }
.relation-main { display: contents; }
.relation-list--events .relation-main { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-sm); min-width: 0; }
/* In an event list the chips follow the name, after the date column. */
.relation-list--events .relation-extras { display: contents; }
@media (max-width: 520px) {
  .relation-list--events { grid-template-columns: fit-content(8.5rem) minmax(0, 1fr); }
  .relation-list--events .relation-row { column-gap: var(--space-sm); }
  .event-date { white-space: normal; }
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
