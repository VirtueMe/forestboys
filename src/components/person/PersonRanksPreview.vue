<template>
  <div v-if="known" class="rank-pills">
    <component
      :is="sortedHistory.length ? 'button' : 'span'"
      class="rank-pill"
      :class="{ 'rank-pill--button': sortedHistory.length }"
      v-bind="sortedHistory.length ? { type: 'button', 'aria-haspopup': 'dialog', title: 'Vis gradshistorikk' } : {}"
      @click="sortedHistory.length && (open = true)"
    >
      <template v-if="acting">
        <span class="rank-acting">fungerende</span>
        <span class="rank-name">{{ acting.targetName }}</span>
        <span class="rank-real">({{ known.rankName }})</span>
      </template>
      <span v-else class="rank-name">{{ known.rankName }}</span>
      <span v-if="sortedHistory.length" class="rank-more" aria-hidden="true">›</span>
    </component>
  </div>

  <div v-if="open" class="popup-scrim" @click="open = false">
    <div class="popup-card" role="dialog" aria-modal="true" aria-label="Gradshistorikk" @click.stop>
      <header class="popup-head">
        <h4 class="popup-title">Gradshistorikk</h4>
        <button type="button" class="popup-close" aria-label="Lukk" @click="open = false">✕</button>
      </header>
      <ol class="history">
        <li v-for="(e, i) in sortedHistory" :key="e.edgeId ?? i" class="history-entry">
          <div class="history-head">
            <span class="history-rank">{{ e.targetName }}</span>
            <span v-if="e.acting" class="history-acting">fungerende</span>
            <span v-if="formatPeriod(e.startDate, e.endDate)" class="history-period">{{ formatPeriod(e.startDate, e.endDate) }}</span>
          </div>
          <SourceRef v-if="e.sourceRefs?.length" :refs="e.sourceRefs" inline class="history-sources" />
          <DescriptionPreview v-if="e.sections.length" :sections="e.sections" class="history-note" />
        </li>
      </ol>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * PersonRanksPreview — the rank pill in the page identity strip
 * (docs/PERSON-RANKS.md R9).
 *
 * Shows the rank the person is known by. When the latest history entry
 * is an open acting rank: "fungerende Kaptein (Løytnant)". With history,
 * the pill opens it — entries by date (undated last), acting marked, each
 * with the sources that prove it and its note (why it was awarded).
 */
import { computed, ref } from 'vue'
import DescriptionPreview from '@/components/DescriptionPreview.vue'
import SourceRef from '@/components/SourceRef.vue'
import { latestOpen } from '@/components/relation/rankStrategies.ts'
import type { RelationEntry } from '@/components/relation/RelationStrategy.ts'
import { comparePartial, formatPeriod } from '@/utils/period.ts'
import type { KnownRank } from './types.ts'

const props = defineProps<{
  known:   KnownRank | null
  history: RelationEntry[]
}>()

const open = ref(false)

const acting = computed(() => latestOpen(props.history, true))

const sortedHistory = computed(() =>
  props.history.filter(e => e.targetSlug).sort((a, b) =>
    !a.startDate ? 1 : !b.startDate ? -1 : comparePartial(a.startDate, b.startDate)),
)
</script>

<style scoped>
.rank-pills {
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
  border: 1px solid transparent;
  border-radius: var(--radius-pill);
  font: inherit;
}
.rank-pill--button { cursor: pointer; }
.rank-pill--button:hover,
.rank-pill--button:focus-visible { border-color: var(--faded-red); }
.rank-name   { font-family: var(--font-sans); font-size: var(--size-label); font-weight: 600; color: var(--ink); }
.rank-acting,
.rank-real   { font-family: var(--font-sans); font-size: var(--size-label); color: var(--ink-soft); }
.rank-more   { font-family: var(--font-sans); font-size: var(--size-label); color: var(--muted); }

.popup-scrim {
  position: fixed;
  inset: 0;
  background: rgba(26, 26, 26, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-md);
  z-index: 200;
}
.popup-card {
  max-width: 640px;
  width: 100%;
  max-height: 85vh;
  overflow-y: auto;
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  padding: var(--space-lg);
}
.popup-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  margin-bottom: var(--space-md);
}
.popup-title {
  font-family: var(--font-serif);
  font-size: var(--size-h2);
  font-weight: 600;
  line-height: var(--leading-snug);
  color: var(--ink);
  margin: 0;
}
.popup-close {
  width: 28px;
  height: 28px;
  padding: 0;
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  background: transparent;
  border: 1px solid var(--rule);
  border-radius: var(--radius-pill);
  cursor: pointer;
  color: var(--muted);
}
.popup-close:hover { border-color: var(--faded-red); color: var(--faded-red); }

.history { list-style: none; margin: 0; padding: 0; }
.history-entry { padding: var(--space-sm) 0; }
.history-entry + .history-entry { border-top: 1px solid var(--rule); }
.history-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-sm);
}
.history-rank   { font-family: var(--font-sans); font-size: var(--size-body-ui); font-weight: 600; color: var(--ink); }
.history-acting { font-family: var(--font-sans); font-size: var(--size-caps); letter-spacing: var(--tracking-caps); text-transform: uppercase; color: var(--ink-soft); }
.history-period { font-family: var(--font-sans); font-size: var(--size-label); color: var(--muted); font-variant-numeric: tabular-nums; }
.history-sources { margin-top: var(--space-xs); }
.history-note   { margin-top: var(--space-xs); }
</style>
