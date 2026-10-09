<template>
  <section class="proposal-list-page">
    <header class="page-head">
      <h1>Forslag</h1>
      <p class="muted">
        Bundles i R2 — {{ query.status === 'pending' ? 'det som venter på en avgjørelse' : 'filtrert' }}.
        <RouterLink to="/admin/proposals/archive">Arkiv</RouterLink>
      </p>
    </header>

    <p v-if="deletedId" class="notice" role="status">
      Bundle arkivert: <code>{{ deletedId }}</code>. Den ligger i <RouterLink to="/admin/proposals/archive">Arkiv</RouterLink> og kan gjenopprettes derfra.
    </p>

    <nav class="tabs" aria-label="Status">
      <button
        v-for="t in tabs" :key="t.value" type="button" class="tab"
        :class="{ 'tab--on': query.status === t.value }" :aria-pressed="query.status === t.value"
        @click="set({ status: t.value })"
      >
        {{ t.label }} <span class="tab-n">{{ answer?.facets.status[t.value] ?? '' }}</span>
      </button>
    </nav>

    <form class="filters" role="search" @submit.prevent="set({ q: text })">
      <input v-model="text" type="search" class="filter-text" placeholder="Søk i oppsummering, id og opphav" aria-label="Søk" @change="set({ q: text })" />
      <label class="filter">Opphav
        <select :value="query.origin" @change="set({ origin: pick($event) as ListQuery['origin'] })">
          <option value="all">Alle</option>
          <option value="outline">Outline</option>
          <option value="package">Pakke</option>
          <option value="sanity">Sanity-synk</option>
        </select>
      </label>
      <label class="filter">Enhetstype
        <select :value="query.kind ?? ''" @change="set({ kind: pick($event) || null })">
          <option value="">Alle</option>
          <option v-for="k in answer?.facets.kinds ?? []" :key="k" :value="k">{{ k }}</option>
        </select>
      </label>
      <label class="filter filter--check"><input type="checkbox" :checked="query.commented" @change="set({ commented: ($event.target as HTMLInputElement).checked })" /> Har kommentar</label>
      <label class="filter">Sorter
        <select :value="query.sort" @change="set({ sort: pick($event) as ListQuery['sort'] })">
          <option value="newest">Nyeste først</option>
          <option value="oldest">Eldste først</option>
          <option value="pending">Flest ventende</option>
          <option value="touched">Sist endret</option>
        </select>
      </label>
      <label class="filter">Per side
        <select :value="query.limit" @change="set({ limit: Number(pick($event)) })">
          <option v-for="n in PAGE_SIZES" :key="n" :value="n">{{ n }}</option>
        </select>
      </label>
      <button v-if="filtered" type="button" class="clear" @click="clear">Nullstill</button>
    </form>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="loading && !answer" class="muted">Laster…</p>

    <template v-else-if="answer">
      <p v-if="!answer.bundles.length" class="muted">
        {{ answer.total === 0 && !filtered && query.status === 'pending' ? 'Ingenting venter på en avgjørelse.' : 'Ingen bundles passer.' }}
        <button v-if="query.status !== 'all' && answer.facets.status.all" type="button" class="link" @click="set({ status: 'all' })">Vis alle ({{ answer.facets.status.all }})</button>
      </p>

      <ul v-else class="bundle-list">
        <li v-for="b in answer.bundles" :key="b.bundleId" class="bundle-row">
          <RouterLink :to="`/admin/proposals/${encodeURIComponent(b.bundleId)}`" class="bundle-link">
            <header class="bundle-row-head">
              <span class="bundle-status" :class="`bundle-status--${b.status}`">{{ bundleStatusLabel(b.status) }}</span>
              <span class="bundle-outline"><code>{{ b.outlineId ?? b.source }}</code></span>
              <span class="bundle-meta">{{ b.createdAt.slice(0, 16).replace('T', ' ') }}</span>
            </header>
            <p class="bundle-summary">{{ b.summary }}</p>
            <footer class="bundle-row-foot">
              <span class="bundle-counts">
                {{ b.entities }} {{ b.entities === 1 ? 'enhet' : 'enheter' }}
                <span v-if="b.counts.pending" class="count-pending">— {{ b.counts.pending }} venter</span>
                <span v-if="b.counts.accepted" class="count-accepted">— {{ b.counts.accepted }} godkjent</span>
                <span v-if="b.counts.denied" class="count-denied">— {{ b.counts.denied }} avvist</span>
                <span v-if="b.counts.drifted" class="count-denied">— {{ b.counts.drifted }} satt til side</span>
                <span v-if="b.comments">— {{ b.comments }} {{ b.comments === 1 ? 'kommentar' : 'kommentarer' }}</span>
              </span>
              <span v-if="b.child" class="bundle-child">barn-bundle</span>
              <span class="bundle-model">{{ b.model === 'none' ? originKindLabel(b.originKind) : b.model }}</span>
            </footer>
          </RouterLink>
        </li>
      </ul>

      <nav v-if="answer.total > query.limit" class="pager" aria-label="Sider">
        <button type="button" :disabled="query.offset === 0" @click="set({ offset: Math.max(0, query.offset - query.limit) }, false)">‹ Forrige</button>
        <span class="muted">{{ query.offset + 1 }}–{{ Math.min(query.offset + query.limit, answer.total) }} av {{ answer.total }}</span>
        <button type="button" :disabled="query.offset + query.limit >= answer.total" @click="set({ offset: query.offset + query.limit }, false)">Neste ›</button>
      </nav>
      <p v-else-if="answer.total" class="muted pager-total">{{ answer.total }} {{ answer.total === 1 ? 'bundle' : 'bundles' }}</p>
    </template>

    <p class="reindex muted">
      Listen leses fra en indeks. Ser noe feil ut? <button type="button" class="link" :disabled="reindexing" @click="reindex">{{ reindexing ? 'Bygger…' : 'Bygg indeksen på nytt' }}</button>
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { authFetch } from '@/composables/useAuth.ts'
import { deletedBundleFromQuery } from '@/utils/proposalNav.ts'
import { bundleStatusLabel } from '@/utils/bundleStatus.ts'
import { DEFAULT_QUERY, PAGE_SIZES, parseQuery, toParams, type ListAnswer, type ListQuery, type OriginKind, type StatusFilter } from '@/utils/bundleIndex.ts'

const route  = useRoute()
const router = useRouter()

// The filters, the page size and the page are the URL's query: a link can be shared, and the back button works.
const asParams = () => new URLSearchParams(Object.entries(route.query).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v] as [string, string]] : [])))
const query    = computed<ListQuery>(() => parseQuery(asParams()))
const filtered = computed(() => toParams({ ...query.value, status: DEFAULT_QUERY.status, limit: DEFAULT_QUERY.limit, offset: 0 }).size > 0)

const answer     = ref<ListAnswer | null>(null)
const loading    = ref(true)
const error      = ref<string | null>(null)
const reindexing = ref(false)
const text       = ref(query.value.q)

// Set by leaveDeletedBundle(); shown once, then dropped from the URL so a reload does not repeat it.
const deletedId = ref(deletedBundleFromQuery(route.query.deleted))

const tabs: { value: StatusFilter; label: string }[] = [
  { value: 'pending', label: 'Venter' },
  { value: 'blocked', label: 'Blokkert' },
  { value: 'closed',  label: 'Lukket' },
  { value: 'all',     label: 'Alle' },
]

const pick = (e: Event) => (e.target as HTMLSelectElement).value

/** Change the query; a change of filter starts again from the first page. */
function set(patch: Partial<ListQuery>, resetPage = true): void {
  const next = { ...query.value, ...patch, ...(resetPage && !('offset' in patch) ? { offset: 0 } : {}) }
  void router.push({ path: route.path, query: Object.fromEntries(toParams(next)) })
}
const clear = () => { text.value = ''; void router.push({ path: route.path, query: Object.fromEntries(toParams({ ...DEFAULT_QUERY, status: query.value.status, limit: query.value.limit })) }) }

async function load(): Promise<void> {
  loading.value = true
  try {
    const res = await authFetch(`/api/admin/proposals?${toParams(query.value).toString()}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    answer.value = await res.json() as ListAnswer
    error.value  = null
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

async function reindex(): Promise<void> {
  reindexing.value = true
  try {
    const res = await authFetch('/api/admin/proposals/reindex', { method: 'POST' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await load()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    reindexing.value = false
  }
}

watch(() => toParams(query.value).toString(), () => { text.value = query.value.q; void load() })

onMounted(() => {
  if (deletedId.value) { const { deleted: _gone, ...rest } = route.query; void router.replace({ path: route.path, query: rest }) }
  void load()
})

function originKindLabel(k: OriginKind): string {
  switch (k) {
    case 'outline': return 'fra outline'
    case 'package': return 'fra pakke'
    case 'sanity':  return 'fra Sanity'
  }
}
</script>

<style scoped>
.proposal-list-page {
  max-width: 960px;
  margin: 0 auto;
  padding: var(--space-md);
}

.page-head { margin-bottom: var(--space-lg); }
.page-head h1 { margin: 0 0 var(--space-xs); font-family: var(--font-serif); font-size: var(--size-h1); }

.muted { color: var(--muted); }
.error { color: var(--danger); }
.notice { color: var(--muted); }

.bundle-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--space-sm); }
.bundle-row { background: var(--paper-raised); border: 1px solid var(--rule); border-radius: var(--radius-md); }
.bundle-link {
  display: block;
  padding: var(--space-md);
  text-decoration: none;
  color: var(--ink);
}
.bundle-row:hover { border-color: var(--focus); }

.bundle-row-head {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  flex-wrap: wrap;
  font-family: var(--font-sans);
  font-size: var(--size-label);
}
.bundle-outline code { font-family: var(--font-mono); }
.bundle-meta { color: var(--muted); font-family: var(--font-mono); }

.bundle-status {
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  font-size: var(--size-caps);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: var(--tracking-caps);
  border: 1px solid var(--rule);
  background: var(--paper-sunken);
  color: var(--ink-soft);
}
.bundle-status--blocked { color: var(--danger); border-color: var(--danger); }
.bundle-status--closed  { color: var(--moss);   border-color: var(--moss);   }

.bundle-summary {
  margin: var(--space-sm) 0;
  font-family: var(--font-serif);
  color: var(--ink);
}

.bundle-row-foot {
  display: flex;
  gap: var(--space-md);
  flex-wrap: wrap;
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--ink-soft);
}
.count-pending  { color: var(--ink-soft); }
.count-accepted { color: var(--moss); }
.count-denied   { color: var(--danger); }
.bundle-child   { color: var(--ink-soft); font-style: italic; }
.bundle-model   { margin-left: auto; color: var(--muted); font-family: var(--font-mono); font-size: 11px; }

.tabs { display: flex; gap: var(--space-xs); flex-wrap: wrap; margin-bottom: var(--space-md); border-bottom: 1px solid var(--rule); }
.tab { font: inherit; font-family: var(--font-sans); padding: 6px 12px; cursor: pointer; background: none; border: 0; border-bottom: 2px solid transparent; color: var(--ink-soft); }
.tab--on { color: var(--ink); border-bottom-color: var(--accent, var(--ink)); font-weight: 600; }
.tab-n { color: var(--muted); font-family: var(--font-mono); font-size: 12px; }

.filters { display: flex; flex-wrap: wrap; gap: var(--space-sm) var(--space-md); align-items: end; margin-bottom: var(--space-md); font-family: var(--font-sans); font-size: var(--size-label); }
.filter-text { flex: 1 1 220px; font: inherit; padding: 6px 10px; background: var(--paper-raised); border: 1px solid var(--rule); border-radius: var(--radius-md); color: var(--ink); }
.filter { display: flex; flex-direction: column; gap: 2px; color: var(--muted); }
.filter select { font: inherit; padding: 5px 8px; background: var(--paper-raised); border: 1px solid var(--rule); border-radius: var(--radius-md); color: var(--ink); }
.filter--check { flex-direction: row; align-items: center; gap: var(--space-xs); color: var(--ink-soft); padding-bottom: 6px; }
.clear, .link { font: inherit; background: none; border: 0; padding: 0; color: var(--ink-soft); text-decoration: underline; cursor: pointer; }
.clear { padding-bottom: 6px; }

.pager { display: flex; align-items: center; justify-content: center; gap: var(--space-md); margin-top: var(--space-md); font-family: var(--font-sans); }
.pager button { font: inherit; padding: 4px 12px; cursor: pointer; background: var(--paper-sunken); border: 1px solid var(--rule); border-radius: var(--radius-md); color: var(--ink); }
.pager button:disabled { opacity: .5; cursor: default; }
.pager-total { text-align: center; margin-top: var(--space-md); }
.reindex { margin-top: var(--space-lg); font-size: var(--size-label); }
</style>
