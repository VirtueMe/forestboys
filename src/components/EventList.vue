<template>
  <div class="event-list-tools">
    <button class="sort-btn" type="button" @click="ascending = !ascending">Dato {{ ascending ? '↑' : '↓' }}</button>
  </div>
  <CollapsibleList :count="items.length" :label="label">
    <div class="event-list">
      <RouterLink v-for="item in sorted" :key="keyOf(item)" :to="`/events/${item.slug}`" class="event-item">
        <span class="event-date" :class="{ undated: !period(item) }">{{ period(item) || '–' }}</span>
        <span class="event-main">
          <span class="event-title">{{ item.title }}</span>
          <slot name="extra" :item="item"></slot>
        </span>
      </RouterLink>
    </div>
  </CollapsibleList>
</template>

<script setup lang="ts" generic="T extends EventListItem">
/**
 * The events on an entity's page (#284): each with when it happened, oldest first, undated last, with a toggle for the
 * order. What a page adds to an item (a direction, a role) goes in the `extra` slot. The section and its heading stay on
 * the page. `keyOf` for a list where one event can appear twice (a station: departed from and arrived at).
 */
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import CollapsibleList from '@/components/CollapsibleList.vue'
import { sortEvents, type EventListItem } from '@/utils/eventList.ts'
import { formatEventPeriod } from '@/utils/period.ts'

const props = withDefaults(defineProps<{ items: readonly T[]; keyOf?: (item: T) => string; label?: string }>(), {
  keyOf: (item: EventListItem) => item.slug,
  label: 'Hendelser',
})
defineSlots<{ extra?(props: { item: T }): unknown }>()

const ascending = ref(true)
const sorted = computed(() => sortEvents(props.items, ascending.value))
const period = (item: T) => formatEventPeriod(item.startDate, item.endDate)
</script>

<style scoped>
.event-list-tools { display: flex; justify-content: flex-end; margin-bottom: 8px; }
.sort-btn {
  background: none;
  border: 1px solid var(--rule);
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  padding: 6px 10px;
  cursor: pointer;
  white-space: nowrap;
  touch-action: manipulation;
}
.sort-btn:hover { border-color: var(--focus); color: var(--focus); }

/* The date first, in a column at least 9rem wide, so the titles start at the same place on every page; a longer period
   widens it. On a phone the date stays first and wraps a long period instead. */
.event-list {
  display: grid;
  grid-template-columns: minmax(9rem, max-content) minmax(0, 1fr);
  row-gap: 2px;
}
.event-item {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: subgrid;
  align-items: baseline;
  column-gap: var(--space-md);
  padding: var(--space-sm);
  margin: 0 calc(-1 * var(--space-sm));
  text-decoration: none;
  color: var(--ink);
  border-bottom: 1px solid var(--rule);
  border-radius: 4px;
  transition: background 0.1s;
}
.event-item:last-child { border-bottom: none; }
.event-item:hover { background: var(--paper); }
.event-item:hover .event-title { text-decoration: underline; }
.event-date {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.event-date.undated { color: var(--muted); font-weight: 400; }
.event-main { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-xs) var(--space-sm); min-width: 0; }
.event-title { font-size: 13px; color: var(--focus); min-width: 0; }

@media (max-width: 520px) {
  .event-list { grid-template-columns: fit-content(8.5rem) minmax(0, 1fr); }
  .event-item { column-gap: var(--space-sm); }
  .event-date { white-space: normal; }
}
</style>
