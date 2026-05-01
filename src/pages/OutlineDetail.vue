<template>
  <div class="outline-detail">
    <div v-if="loading" class="status">Laster…</div>

    <div v-else-if="!item" class="status">Oppføring ikke funnet.</div>

    <template v-else>
      <!-- Header -->
      <div class="page-header">
        <RouterLink to="/registre" class="back-link">&#x2039; Tilbake</RouterLink>
        <h1 class="item-title">{{ item.canonicalName }}</h1>
      </div>

      <AdminViewTabs
        v-if="isAdmin"
        v-model="mode"
        :proposal-count="openBundles.length"
        :proposal-running="botRunning"
      />

      <!-- Proposals tab (admin only) — one bundle at a time, navigable via the nav row -->
      <template v-if="isAdmin && mode === 'proposals' && currentBundle">
        <BundleReviewPanel
          :key="currentBundle.bundleId"
          :bundle-id="currentBundle.bundleId"
          :older-bundle="olderBundle"
          :newer-bundle="newerBundle"
          @deleted="onBundleDeleted"
          @navigate="onBundleNavigate"
        />
      </template>

      <!-- Edit pane (admin only) -->
      <template v-if="isAdmin && mode === 'edit'">
        <section class="section edit-pane">
          <h3 class="section-heading">Bot</h3>
          <button
            type="button"
            class="bot-request"
            :disabled="requesting || botRunning"
            @click="onRequestBundle"
          >
            {{ requesting ? 'Sender…' : botRunning ? 'Jobber…' : 'Be om forslag' }}
          </button>
          <button
            v-if="botRunning"
            type="button"
            class="bot-cancel"
            :disabled="cancelling"
            @click="onCancelPending"
          >
            {{ cancelling ? 'Avbryter…' : 'Avbryt' }}
          </button>
          <p v-if="requestResult" class="bot-result">
            Sendt — <a v-if="requestResult.issueUrl" :href="requestResult.issueUrl" target="_blank" rel="noopener">issue {{ requestResult.issueNumber || 'lokal' }}</a>
          </p>
          <p v-if="requestError" class="bot-error">{{ requestError }}</p>
        </section>
        <DescriptionEditor
          :saved="savedSections"
          :endpoint="`/api/admin/outline/${item.slug}/sections`"
          @saved="onSectionsSaved"
        />
        <section class="section edit-pane">
          <button
            type="button"
            class="bot-request"
            :disabled="requesting || botRunning"
            @click="onRequestBundle"
          >
            {{ requesting ? 'Sender…' : botRunning ? 'Jobber…' : 'Be om forslag' }}
          </button>
        </section>
      </template>

      <!-- View panes -->
      <template v-if="!isAdmin || mode === 'preview'">
        <section v-if="descriptionHtml" class="section">
          <h3 class="section-heading">Beskrivelse</h3>
          <!-- eslint-disable vue/no-v-html -->
          <div class="portable-text" v-html="descriptionHtml"></div>
          <!-- eslint-enable vue/no-v-html -->
        </section>

        <section v-if="mentions.length" class="section">
          <h3 class="section-heading">Omtalte personer ({{ mentions.length }})</h3>
          <div class="link-list">
            <RouterLink
              v-for="p in mentions"
              :key="p.slug"
              :to="`/person/${p.slug}`"
              class="section-link"
            >
              {{ p.name }}
            </RouterLink>
          </div>
        </section>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, inject } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { useOutlineData } from '../composables/useOutlineData.ts'
import { OutlineDataKey } from '../composables/proposalDataInjection.ts'
import { authFetch, useAuth } from '../composables/useAuth.ts'
import { blocksToHtml } from '../utils/portableText.ts'
import AdminViewTabs, { type AdminViewMode } from '../components/AdminViewTabs.vue'
import DescriptionEditor from '../components/DescriptionEditor.vue'
import BundleReviewPanel from '../components/BundleReviewPanel.vue'
import type { Section } from '../components/SectionsEditor.vue'

const mode = ref<AdminViewMode>('preview')

const route  = useRoute()
const router = useRouter()
const { user } = useAuth()
const isAdmin = computed(() => user.value?.role === 'admin')

interface OpenBundle { bundleId: string; summary: string; createdAt: string }

const data = inject(OutlineDataKey, () => useOutlineData(), true)
const { outline: item, savedSections, mentions, loadOutline, resetOutline } = data

const openBundles      = ref<OpenBundle[]>([])
const viewingBundleId  = ref<string | null>(null)

const sortedBundles = computed<OpenBundle[]>(() =>
  [...openBundles.value].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
)
const currentIdx = computed(() => {
  if (!sortedBundles.value.length) return -1
  if (viewingBundleId.value) {
    const idx = sortedBundles.value.findIndex((b) => b.bundleId === viewingBundleId.value)
    return idx === -1 ? 0 : idx
  }
  return 0
})
const currentBundle = computed<OpenBundle | null>(() =>
  currentIdx.value >= 0 ? sortedBundles.value[currentIdx.value] : null,
)
const newerBundle = computed<OpenBundle | undefined>(() =>
  currentIdx.value > 0 ? sortedBundles.value[currentIdx.value - 1] : undefined,
)
const olderBundle = computed<OpenBundle | undefined>(() =>
  currentIdx.value >= 0 && currentIdx.value < sortedBundles.value.length - 1
    ? sortedBundles.value[currentIdx.value + 1]
    : undefined,
)

function onBundleNavigate(bundleId: string): void {
  viewingBundleId.value = bundleId
  void router.replace({ path: route.path, query: route.query, hash: `#proposal=${encodeURIComponent(bundleId)}` })
}

function onBundleDeleted(): void {
  if (item.value) void loadOpenBundles(item.value.slug)
  viewingBundleId.value = null
  void router.replace({ path: route.path, query: route.query, hash: '' })
}

// Sync from URL hash (#proposal=<bundleId>) on mount + route changes.
function syncFromHash(): void {
  const m = route.hash.match(/^#proposal=(.+)$/)
  viewingBundleId.value = m ? decodeURIComponent(m[1]) : null
}
watch(() => route.hash, syncFromHash, { immediate: true })

const loading = ref(true)

async function load(slug: string): Promise<void> {
  loading.value     = true
  openBundles.value = []
  resetOutline()
  try {
    await loadOutline(slug)
    if (isAdmin.value && item.value) void loadOpenBundles(slug)
  } finally {
    loading.value = false
  }
}

async function loadOpenBundles(slug: string): Promise<void> {
  try {
    const res = await authFetch(`/api/admin/Outline/${slug}/proposals`)
    if (!res.ok) return
    const body = await res.json() as { openBundles?: OpenBundle[]; generationPending?: boolean }
    openBundles.value = body.openBundles ?? []
    botRunning.value  = body.generationPending ?? false
  } catch { /* silent — proposal pane just stays empty */ }
}

// Realtime updates via SSE — re-fetch openBundles whenever a bundle
// event fires for the current outline.
let eventSource: EventSource | null = null
function openEventStream(slug: string): void {
  if (eventSource) eventSource.close()
  eventSource = new EventSource(`/api/proposals/events?outlineId=${encodeURIComponent(slug)}`)
  eventSource.onmessage = () => {
    if (item.value?.slug === slug) {
      botRunning.value = false
      void loadOpenBundles(slug)
    }
  }
  eventSource.onerror = () => {
    // Browser auto-reconnects after a delay; nothing to do here.
  }
}
watch(() => item.value?.slug, (s, prev) => {
  if (s && s !== prev && isAdmin.value) openEventStream(s)
})
watch(isAdmin, (admin) => {
  if (admin && item.value?.slug) openEventStream(item.value.slug)
})

onUnmounted(() => { eventSource?.close(); eventSource = null })

function onSectionsSaved(sections: Section[]): void {
  savedSections.value = sections
}

const descriptionHtml = computed<string>(() => {
  const parts: string[] = []
  for (const s of savedSections.value) {
    if (!s.content) continue
    try {
      const blocks = JSON.parse(s.content) as unknown[]
      parts.push(blocksToHtml(blocks as Parameters<typeof blocksToHtml>[0]))
    } catch { /* skip malformed */ }
  }
  return parts.join('')
})

onMounted(() => { void load(route.params.slug as string) })
watch(() => route.params.slug as string, (s) => { if (s) void load(s) })

const requesting    = ref(false)
const requestResult = ref<{ issueNumber: number; issueUrl: string } | null>(null)
const requestError  = ref<string | null>(null)
const botRunning    = ref(false)
const cancelling    = ref(false)

async function onCancelPending(): Promise<void> {
  if (!item.value) return
  if (!window.confirm('Avbryt ventende bot-jobb? Markeringen fjernes lokalt; en kjørende GitHub-action stoppes ikke.')) return
  cancelling.value = true
  try {
    await authFetch(`/api/admin/proposals/pending/${item.value.slug}`, { method: 'DELETE' })
    botRunning.value = false
  } finally {
    cancelling.value = false
  }
}

async function onRequestBundle(): Promise<void> {
  if (!item.value) return
  requesting.value    = true
  requestResult.value = null
  requestError.value  = null
  try {
    const res = await authFetch('/api/proposals/request', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        outlineId:  item.value.slug,
        outlineRev: item.value.sanityRev ?? 'smoke-test',
        promptHash: '000000000000',
      }),
    })
    const body = await res.json().catch(() => ({})) as
      { issueNumber?: number; issueUrl?: string; error?: string }
    if (!res.ok) {
      requestError.value = body.error ?? `HTTP ${res.status}`
      return
    }
    requestResult.value = {
      issueNumber: body.issueNumber ?? 0,
      issueUrl:    body.issueUrl    ?? '',
    }
    botRunning.value = true
  } catch (e) {
    requestError.value = (e as Error).message
  } finally {
    requesting.value = false
  }
}
</script>

<style scoped>
.outline-detail {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: var(--paper);
  display: flex;
  flex-direction: column;
  align-items: center;
}

.outline-detail > * {
  width: 100%;
  max-width: 1320px;
}

.status {
  padding: 48px 20px;
  text-align: center;
  font-size: 13px;
  color: var(--muted);
}

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
  margin: 0;
  line-height: 1.25;
}

.admin-bar {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-wrap: wrap;
}
.bot-request {
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  border: 1px solid var(--rule);
  background: var(--paper-sunken);
  color: var(--ink);
  cursor: pointer;
}
.bot-request:hover:not([disabled]) { background: var(--paper); border-color: var(--ink-soft); }
.bot-request[disabled] { opacity: 0.5; cursor: not-allowed; }

.bot-cancel {
  margin-left: var(--space-sm);
  font-family: var(--font-sans);
  font-size: var(--size-label);
  padding: 4px 10px;
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--ink-soft);
  cursor: pointer;
}
.bot-cancel:hover:not([disabled]) { color: var(--danger); border-color: var(--danger); }
.bot-cancel[disabled] { opacity: 0.5; cursor: not-allowed; }
.bot-result { margin: 0; font-size: var(--size-label); color: var(--ink-soft); }
.bot-result a { color: var(--focus); }
.bot-error { margin: 0; font-size: var(--size-label); color: var(--danger); }



.section {
  padding: 12px 16px;
  border-bottom: 1px solid var(--rule);
  background: var(--paper-raised);
}

.section-heading {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--muted);
  margin: 0 0 8px;
}

.portable-text :deep(p)  { margin: 0 0 8px; line-height: 1.55; color: var(--ink); }
.portable-text :deep(h1),
.portable-text :deep(h2),
.portable-text :deep(h3) { margin: 16px 0 8px; color: var(--ink); }

.link-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
}

.section-link {
  font-size: 13px;
  color: var(--focus);
  text-decoration: none;
}
.section-link:hover { text-decoration: underline; }
</style>
