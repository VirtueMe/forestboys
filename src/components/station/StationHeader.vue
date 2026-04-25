<template>
  <div class="page-header">
    <RouterLink to="/registre" class="back-link">&#x2039; Tilbake</RouterLink>
    <h1 class="item-title">{{ name }}</h1>
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
 * StationHeader — back link + station name + type pill + active period
 * + coordinates row. Sits at the page top above the View / Edit tabs.
 */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

const props = defineProps<{
  name:        string
  type?:       string | null
  activeFrom?: string | null
  activeTo?:   string | null
  lat?:        number | null
  lng?:        number | null
}>()

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
