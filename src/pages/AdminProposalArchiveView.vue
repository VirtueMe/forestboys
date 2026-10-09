<template>
  <section class="archive-page">
    <header class="page-head">
      <h1>Arkiv</h1>
      <p class="muted">Bundles som er arkivert — med hvem, når og hvorfor. <RouterLink to="/admin/proposals">Til forslagene</RouterLink></p>
    </header>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="loading" class="muted">Laster…</p>
    <p v-else-if="!bundles.length" class="muted">Ingen arkiverte bundles.</p>

    <ul v-else class="archive-list">
      <li v-for="b in bundles" :key="b.bundleId" class="archive-row">
        <RouterLink :to="`/admin/proposals/archive/${encodeURIComponent(b.bundleId)}`" class="archive-link">
          <header class="row-head">
            <span class="bundle-status" :class="`bundle-status--${b.status}`">{{ bundleStatusLabel(b.status) }}</span>
            <code>{{ b.bundleId }}</code>
          </header>
          <p class="summary">{{ b.summary }}</p>
          <p class="why"><strong>{{ b.archivedBy }}</strong> arkiverte den {{ b.archivedAt.slice(0, 16).replace('T', ' ') }}: «{{ b.reason }}»</p>
          <footer class="row-foot">
            {{ b.entities }} {{ b.entities === 1 ? 'enhet' : 'enheter' }}
            <span v-if="b.counts.pending">— {{ b.counts.pending }} ventet</span>
            <span v-if="b.counts.accepted">— {{ b.counts.accepted }} godkjent</span>
            <span v-if="b.counts.denied">— {{ b.counts.denied }} avvist</span>
            <span v-if="b.counts.drifted">— {{ b.counts.drifted }} satt til side</span>
            <span class="restorable">{{ b.restorable ? 'kan gjenopprettes' : 'har godkjente enheter: bare et arkiv' }}</span>
          </footer>
        </RouterLink>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { authFetch } from '@/composables/useAuth.ts'
import { bundleStatusLabel } from '@/utils/bundleStatus.ts'
import type { ArchiveSummary } from '@/utils/bundleArchive.ts'

const bundles = ref<ArchiveSummary[]>([])
const loading = ref(true)
const error   = ref<string | null>(null)

onMounted(async () => {
  try {
    const res = await authFetch('/api/admin/proposals/archive')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    bundles.value = (await res.json() as { bundles: ArchiveSummary[] }).bundles
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.archive-page { max-width: 960px; margin: 0 auto; padding: var(--space-md); }
.page-head { margin-bottom: var(--space-lg); }
.page-head h1 { margin: 0 0 var(--space-xs); font-family: var(--font-serif); font-size: var(--size-h1); }
.muted { color: var(--muted); }
.error { color: var(--danger); }

.archive-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-sm); }
.archive-row { background: var(--paper-raised); border: 1px solid var(--rule); border-radius: var(--radius-md); }
.archive-link { display: block; padding: var(--space-md); color: inherit; text-decoration: none; }
.archive-link:hover { background: var(--paper-sunken); }
.row-head { display: flex; align-items: baseline; gap: var(--space-md); flex-wrap: wrap; }
.summary { margin: var(--space-xs) 0; }
.why { margin: 0 0 var(--space-xs); color: var(--ink-soft); }
.row-foot { color: var(--muted); font-size: 13px; display: flex; gap: var(--space-xs); flex-wrap: wrap; }
.restorable { margin-left: auto; }

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
</style>
