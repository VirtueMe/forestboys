<template>
  <div class="page-header">
    <RouterLink to="/registre" class="back-link">&#x2039; Tilbake</RouterLink>
    <h1 class="item-name">{{ name }}</h1>
    <p v-if="meta" class="item-meta">{{ meta }}</p>
  </div>
</template>

<script setup lang="ts">
/**
 * TransportHeader — back link + transport name + concatenated meta line
 * (type · unit · regser · reserve, omitting empty fields).
 */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

const props = defineProps<{
  name:     string
  type?:    string | null
  unit?:    string | null
  regser?:  string | null
  reserve?: string | null
}>()

const meta = computed(() => {
  const parts = [props.type, props.unit, props.regser, props.reserve].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
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
.item-name {
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
}
</style>
