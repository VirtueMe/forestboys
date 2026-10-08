<template>
  <section class="proposal-list-page">
    <header class="page-head">
      <h1>Forslag</h1>
      <p class="muted">Alle bundles i R2 — nyeste øverst.</p>
    </header>

    <p v-if="deletedId" class="notice" role="status">
      Bundle slettet: <code>{{ deletedId }}</code>
    </p>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="loading" class="muted">Laster…</p>

    <p v-else-if="!bundles.length" class="muted">Ingen bundles ennå.</p>

    <ul v-else class="bundle-list">
      <li v-for="b in bundles" :key="b.bundleId" class="bundle-row">
        <RouterLink :to="`/admin/proposals/${encodeURIComponent(b.bundleId)}`" class="bundle-link">
          <header class="bundle-row-head">
            <span class="bundle-status" :class="`bundle-status--${b.status}`">{{ bundleStatusLabel(b.status) }}</span>
            <span class="bundle-outline"><code>{{ b.outlineId ?? b.source }}</code></span>
            <span class="bundle-meta">{{ b.createdAt.slice(0, 16).replace('T', ' ') }}</span>
          </header>
          <p class="bundle-summary">{{ b.summary }}</p>
          <footer class="bundle-row-foot">
            <span class="bundle-counts">
              {{ b.totalEntities }} enheter
              <span v-if="b.pendingCount" class="count-pending">— {{ b.pendingCount }} venter</span>
              <span v-if="b.acceptedCount" class="count-accepted">— {{ b.acceptedCount }} godkjent</span>
              <span v-if="b.deniedCount" class="count-denied">— {{ b.deniedCount }} avvist</span>
              <span v-if="b.driftedCount" class="count-denied">— {{ b.driftedCount }} satt til side</span>
            </span>
            <span v-if="b.parentBundle" class="bundle-child">barn-bundle</span>
            <span class="bundle-model">{{ b.model === 'none' ? originKindLabel(b.originKind) : b.model }}</span>
          </footer>
        </RouterLink>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { authFetch } from '@/composables/useAuth.ts'
import { deletedBundleFromQuery } from '@/utils/proposalNav.ts'
import { bundleStatusLabel, type BundleStatus } from '@/utils/bundleStatus.ts'

interface BundleSummary {
  bundleId:      string
  /** "outline <slug>" / "Sanity <type>" */
  source:        string
  outlineId:     string | null
  summary:       string
  model:         string
  createdAt:     string
  status:        BundleStatus
  originKind:    'outline' | 'package' | 'sanity'
  driftedCount:  number
  pendingCount:  number
  acceptedCount: number
  deniedCount:   number
  totalEntities: number
  parentBundle:  string | null
}

const bundles = ref<BundleSummary[]>([])
const loading = ref(true)

const route     = useRoute()
const router    = useRouter()
// Set by leaveDeletedBundle(); shown once, then dropped from the URL so a reload does not repeat it.
const deletedId = ref(deletedBundleFromQuery(route.query.deleted))
if (deletedId.value) void router.replace({ path: route.path })
const error   = ref<string | null>(null)

onMounted(async () => {
  try {
    const res = await authFetch('/api/admin/proposals')
    if (!res.ok) {
      error.value = `HTTP ${res.status}`
      return
    }
    const body = await res.json() as { bundles: BundleSummary[] }
    bundles.value = body.bundles
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
})

function originKindLabel(k: 'outline' | 'package' | 'sanity'): string {
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
</style>
