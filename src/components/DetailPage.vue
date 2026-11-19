<template>
  <div class="detail-page" :class="pageClass">
    <div v-if="loading" class="status">Laster…</div>
    <div v-else-if="notFound" class="status">{{ notFoundText ?? 'Ikke funnet.' }}</div>
    <slot v-else></slot>
    <SaveRow v-if="!loading && !notFound" />
  </div>
</template>

<script setup lang="ts">
/**
 * Shell + reactive fetch for entity detail pages (Org, Unit, Person, …).
 *
 * Handles:
 *   - the page-shell layout (overflow-y scroll, flex column, centered max-width)
 *   - the Laster… / ikke-funnet status states
 *   - the sticky save row (SaveRow) and the registry the editors report to
 *   - re-fetching on route-param change (keep-alive in App.vue reuses the
 *     component instance across /org/X → /org/Y, so onMounted alone misses it)
 *
 * The caller owns its entity refs and passes in:
 *   :load   — async (slug) => void  — runs the Neo4j fetches, sets refs
 *   :reset  — () => void            — clears refs before the next load
 *   :notFound — boolean / computed  — true when the current slug has no match
 *   :pageClass — string             — extra class for page-specific styles
 */
import { onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import { useDetailSlug } from '@/composables/useDetailSlug.ts'
import { neo4jQuery } from '@/composables/useNeo4j.ts'
import { aliasRedirect } from '@/utils/aliasRedirect.ts'
import { mayLeave, provideSaveRegistry } from '@/composables/useSaveRegistry.ts'
import SaveRow from '@/components/SaveRow.vue'

const props = defineProps<{
  load:         (slug: string) => Promise<void>
  reset:        () => void
  notFound?:    boolean
  notFoundText?: string
  pageClass?:   string
}>()

// The page owns the save row; editors below register with it (#427).
const registry = provideSaveRegistry()

// Leaving with unsaved sections asks first, naming them. Another entity on the same route (`/person/X` → `/person/Y`)
// is leaving too; the same entity (`:child`, a query) is not. Closing or reloading the tab gets the browser's own prompt.
onBeforeRouteLeave(() => mayLeave(registry))
onBeforeRouteUpdate((to, from) => to.params.slug === from.params.slug || mayLeave(registry))

function warnOnUnload(e: BeforeUnloadEvent) {
  if (!registry.dirtyCount.value) return
  e.preventDefault()
  e.returnValue = ''
}
// A kept-alive page is not unmounted when it is left, so the listener follows activation too.
const listen   = () => window.addEventListener('beforeunload', warnOnUnload)
const unlisten = () => window.removeEventListener('beforeunload', warnOnUnload)
onMounted(listen)
onActivated(listen)
onDeactivated(unlisten)
onBeforeUnmount(unlisten)

const detailSlug = useDetailSlug()
const loading    = ref(false)

async function run(slug: string) {
  if (!slug) return
  loading.value = true
  props.reset()
  try { await props.load(slug) }
  catch (err) { console.error('[DetailPage]', err) }
  finally { loading.value = false }
}

watch(detailSlug, run, { immediate: true })

// A slug that finds nothing may be the old address of a page that was renamed: go to the page (#96).
const route  = useRoute()
const router = useRouter()
watch([() => props.notFound, loading], async ([missing, busy]) => {
  if (!missing || busy) return
  const path = route.path
  try {
    const to = await aliasRedirect(path, neo4jQuery)
    if (to && route.path === path) void router.replace({ path: to, query: route.query, hash: route.hash })
  } catch (err) { console.error('[DetailPage] alias lookup', err) }
})
</script>

<style scoped>
.detail-page {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: var(--paper);
  display: flex;
  flex-direction: column;
  align-items: center;
}
.detail-page > * {
  width: 100%;
  max-width: var(--content-max-width);
}

.status {
  padding: var(--space-xl) var(--space-lg);
  text-align: center;
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--muted);
}
</style>
