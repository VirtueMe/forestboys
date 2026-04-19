<template>
  <div class="detail-page" :class="pageClass">
    <div v-if="loading" class="status">Laster…</div>
    <div v-else-if="notFound" class="status">{{ notFoundText ?? 'Ikke funnet.' }}</div>
    <slot v-else></slot>
  </div>
</template>

<script setup lang="ts">
/**
 * Shell + reactive fetch for entity detail pages (Org, Unit, Person, …).
 *
 * Handles:
 *   - the page-shell layout (overflow-y scroll, flex column, centered max-width)
 *   - the Laster… / ikke-funnet status states
 *   - re-fetching on route-param change (keep-alive in App.vue reuses the
 *     component instance across /org/X → /org/Y, so onMounted alone misses it)
 *
 * The caller owns its entity refs and passes in:
 *   :load   — async (slug) => void  — runs the Neo4j fetches, sets refs
 *   :reset  — () => void            — clears refs before the next load
 *   :notFound — boolean / computed  — true when the current slug has no match
 *   :pageClass — string             — extra class for page-specific styles
 */
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'

const props = defineProps<{
  load:         (slug: string) => Promise<void>
  reset:        () => void
  notFound?:    boolean
  notFoundText?: string
  pageClass?:   string
}>()

const route   = useRoute()
const loading = ref(false)

async function run(slug: string) {
  if (!slug) return
  loading.value = true
  props.reset()
  try { await props.load(slug) }
  catch (err) { console.error('[DetailPage]', err) }
  finally { loading.value = false }
}

watch(() => route.params.slug as string, run, { immediate: true })
</script>

<style scoped>
.detail-page {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: var(--color-bg);
  display: flex;
  flex-direction: column;
  align-items: center;
}
.detail-page > * {
  width: 100%;
  max-width: 1320px;
}

.status {
  padding: 48px 20px;
  text-align: center;
  font-size: 13px;
  color: var(--color-muted);
}
</style>
