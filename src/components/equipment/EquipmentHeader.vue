<template>
  <div class="page-header">
    <RouterLink to="/registre" class="back-link">&#x2039; Tilbake</RouterLink>
    <h1 class="item-title">{{ name }}</h1>
    <p class="item-meta">
      <span class="type-pill">{{ typeLabel }}</span>
      <span v-if="subtype" class="subtype">{{ subtype }}</span>
      <span v-if="country" class="coords">{{ country }}</span>
      <span v-if="period" class="period">{{ period }}</span>
    </p>
  </div>
</template>

<script setup lang="ts">
/**
 * EquipmentHeader — back link + equipment name + type pill, subtype,
 * country code and period. Sits above the View / Edit tabs.
 */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { EQUIPMENT_TYPE_LABEL } from '@/composables/useEquipmentData.ts'

const props = defineProps<{
  name:     string
  type?:    string | null
  subtype?: string | null
  country?: string | null
  period?:  string | null
}>()

const typeLabel = computed(() =>
  props.type ? (EQUIPMENT_TYPE_LABEL[props.type] ?? props.type) : 'Utstyr',
)
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
.subtype { font-style: italic; }
.period  { font-variant-numeric: tabular-nums; }
.coords { font-family: var(--font-mono); font-size: 11px; font-variant-numeric: tabular-nums; }
</style>
