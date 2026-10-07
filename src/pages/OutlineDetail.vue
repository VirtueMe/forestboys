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
          <h2 class="section-heading">Bot</h2>
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
          <h2 class="section-heading">Beskrivelse</h2>
          <!-- eslint-disable vue/no-v-html -->
          <div class="portable-text" v-html="descriptionHtml"></div>
          <!-- eslint-enable vue/no-v-html -->
        </section>

        <section v-if="mentions.length" class="section">
          <h2 class="section-heading">Omtalte personer ({{ mentions.length }})</h2>
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
import { ref, computed, onMounted, watch, inject } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { useOutlineData } from '../composables/useOutlineData.ts'
import { OutlineDataKey } from '../composables/proposalDataInjection.ts'
import { useEntityBundles } from '../composables/useEntityBundles.ts'
import { authFetch, useAuth } from '../composables/useAuth.ts'
import { blocksToHtml } from '../utils/portableText.ts'
import AdminViewTabs, { type AdminViewMode } from '../components/AdminViewTabs.vue'
import DescriptionEditor from '../components/DescriptionEditor.vue'
import BundleReviewPanel from '../components/BundleReviewPanel.vue'
import type { Section } from '../components/SectionsEditor.vue'

const mode = ref<AdminViewMode>('preview')

const route  = useRoute()
const { user } = useAuth()
const isAdmin = computed(() => user.value?.role === 'admin')

const data = inject(OutlineDataKey, () => useOutlineData(), true)
const { outline: item, savedSections, mentions, loadOutline, resetOutline } = data

const outlineSlug = computed(() => item.value?.slug ?? null)
const bundles = useEntityBundles({
  kind:              'Outline',
  slug:              outlineSlug,
  isAdmin,
  realtimeOutlineId: outlineSlug,
})
bundles.focusOnHash(mode)
const { openBundles, currentBundle, newerBundle, olderBundle, onBundleNavigate, onBundleDeleted, loadOpenBundles, generationPending } = bundles

// Surface the server-side pending-generation marker as the bot-running flag.
watch(generationPending, (v) => { if (v) botRunning.value = true; else botRunning.value = false })

const loading = ref(true)

async function load(slug: string): Promise<void> {
  loading.value = true
  resetOutline()
  try {
    await loadOutline(slug)
    if (isAdmin.value && item.value) void loadOpenBundles(slug)
  } finally {
    loading.value = false
  }
}

function onSectionsSaved(sections: Section[]): void {
  savedSections.value = sections
}

const descriptionHtml = computed<string>(() => {
  const parts: string[] = []
  for (const s of savedSections.value) {
    if (!s.content) continue
    try {
      const blocks = JSON.parse(s.content) as unknown[]
      parts.push(blocksToHtml(blocks))
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
    // The version of an outline is a hash of its text (not Sanity's _rev, which goes at the cutover): read it from
    // the server, which also knows what the last accepted bundle was made from (#157).
    const vres = await authFetch(`/api/admin/outline/${encodeURIComponent(item.value.slug)}/version`)
    if (!vres.ok) {
      requestError.value = `Kunne ikke lese versjonen av teksten (HTTP ${vres.status})`
      return
    }
    const version = await vres.json() as { contentSha: string; state: 'new' | 'absorbed' | 'stale' }
    if (version.state === 'absorbed') {
      requestError.value = 'Teksten er den samme som den siste godkjente pakken ble laget av: det er ingenting nytt å foreslå.'
      return
    }
    const res = await authFetch('/api/proposals/request', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        outlineId:  item.value.slug,
        outlineRev: version.contentSha,
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
