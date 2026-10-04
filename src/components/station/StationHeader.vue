<template>
  <div class="page-header">
    <RouterLink to="/registre" class="back-link">&#x2039; Tilbake</RouterLink>
    <h1 class="item-title">{{ name }}</h1>
    <p v-if="nameSummary.length" class="item-names">
      <span v-for="g in nameSummary" :key="g.label" class="names-group">
        <span class="names-label">{{ g.label }}:</span>
        {{ g.text }}
      </span>
    </p>
    <p v-if="type || activeFrom || activeTo || coords" class="item-meta">
      <span v-if="type" class="type-pill">{{ type }}</span>
      <span v-if="activeFrom || activeTo" class="period">
        {{ activeFrom ?? '?' }}<span v-if="activeTo"> – {{ activeTo }}</span>
      </span>
      <span v-if="coords" class="coords">{{ coords }}</span>
    </p>
  </div>
</template>

<script setup lang="ts">
/**
 * StationHeader — back link + station name + the other names + type pill
 * + active period + coordinates row. Sits at the page top above the View / Edit tabs.
 */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import {
  NAME_TYPE_SHORT, formatNamePeriod, sortNames, type NameLike, type NameType,
} from '@/utils/stationNames.ts'

const props = defineProps<{
  name:        string
  /** The Station's other names (HAS_NAME), saved ones. */
  names?:      NameLike[]
  type?:       string | null
  activeFrom?: string | null
  activeTo?:   string | null
  lat?:        number | null
  lng?:        number | null
}>()

/** "Tidligere: A (– 1943) · Senere: STS 47 (ca. 1943 –)" — one group per type. */
const nameSummary = computed(() => {
  const groups: { label: string; text: string }[] = []
  for (const type of ['former', 'later', 'alias'] as NameType[]) {
    const items = sortNames((props.names ?? []).filter(n => n.type === type))
    if (!items.length) continue
    groups.push({
      label: NAME_TYPE_SHORT[type],
      text:  items.map(n => { const p = formatNamePeriod(n); return p ? `${n.value} (${p})` : n.value }).join(', '),
    })
  }
  return groups
})

const coords = computed(() => {
  if (props.lat == null || props.lng == null) return null
  return `${props.lat.toFixed(4)}, ${props.lng.toFixed(4)}`
})
</script>

<style scoped>
.page-header {
  padding: 14px 16px 12px;
  background: var(--paper-raised);
  border-bottom: 1px solid var(--rule);
}
.back-link {
  display: inline-block;
  font-size: 13px;
  font-weight: 600;
  color: var(--focus);
  text-decoration: none;
  margin-bottom: 10px;
}
.back-link:hover { text-decoration: underline; }
.item-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--ink);
  margin: 0 0 4px;
  line-height: 1.25;
  overflow-wrap: break-word;
}
.item-names {
  font-size: 13px;
  color: var(--ink-soft);
  margin: 0 0 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 2px 14px;
}
.names-label { color: var(--muted); }
.item-meta {
  font-size: 12px;
  color: var(--muted);
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}
.type-pill {
  display: inline-block;
  padding: 1px 6px;
  border: 1px solid var(--rule);
  border-radius: 3px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.period { font-variant-numeric: tabular-nums; }
.coords { font-family: var(--font-mono); font-size: 11px; font-variant-numeric: tabular-nums; }
</style>
