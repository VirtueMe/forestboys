<template>
  <div ref="root" class="collapsible-list" :class="{ 'collapsible-list--boxed': boxed }">
    <div
      class="collapsible-box"
      :tabindex="boxed ? 0 : undefined"
      :role="boxed ? 'region' : undefined"
      :aria-label="boxed ? `${label}, ${count} rader` : undefined"
    >
      <slot></slot>
    </div>
    <button
      v-if="long"
      type="button"
      class="collapsible-toggle"
      :aria-expanded="expanded"
      @click="toggle"
    >
      {{ expanded ? 'Vis færre' : `Vis alle ${count}` }}
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * A long list on an entity's page (#292): more than `threshold` rows show in a box about 15 rows high with a scrollbar of
 * its own, so the page does not have to scroll past all of it; «Vis alle n» shows it at full length, «Vis færre» puts it
 * back in the box and, when the list's top has scrolled out of sight, brings the reader back to it. A shorter list is
 * left as it is. The box is focusable, so it scrolls with the keyboard.
 */
import { computed, nextTick, ref } from 'vue'

const props = withDefaults(defineProps<{
  count:      number
  /** What the list is, for a screen reader: «Deltakere», «Hendelser». */
  label:      string
  threshold?: number
}>(), { threshold: 20 })

const expanded = ref(false)
const root     = ref<HTMLElement | null>(null)
const long     = computed(() => props.count > props.threshold)
const boxed    = computed(() => long.value && !expanded.value)

async function toggle() {
  expanded.value = !expanded.value
  if (expanded.value) return
  await nextTick()
  const el = root.value
  if (!el) return
  // Out of sight counts the page's sticky tab bar too: the same margin the scroll leaves for it.
  const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0
  if (el.getBoundingClientRect().top < margin) el.scrollIntoView({ block: 'start' })
}
</script>

<style scoped>
/* Room for the page's sticky tab bar and the list's heading when collapsing brings the list back into view. */
.collapsible-list { scroll-margin-top: 6rem; }
/* The box makes room for rows that reach past the list (EventList's hover background), instead of clipping them or
   scrolling sideways. */
.collapsible-list--boxed .collapsible-box {
  max-height: min(30rem, 60vh);
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0 var(--space-sm);
  margin: 0 calc(-1 * var(--space-sm));
  border-top: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
}
.collapsible-box:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.collapsible-toggle {
  margin-top: var(--space-sm);
  background: none;
  border: 1px solid var(--rule);
  border-radius: 4px;
  font-family: var(--font-sans);
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  padding: 6px 10px;
  cursor: pointer;
  touch-action: manipulation;
}
.collapsible-toggle:hover { border-color: var(--focus); color: var(--focus); }
.collapsible-toggle:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }

@media (max-width: 520px) {
  .collapsible-list--boxed .collapsible-box { max-height: min(22rem, 55vh); }
}
</style>
