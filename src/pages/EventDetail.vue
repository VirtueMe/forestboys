<template>
  <div class="event-page">
    <button class="back-btn" @click="router.back()">&#x2039; Tilbake</button>

    <div v-if="isAdmin && nodeKind" class="kind-bar">
      <span class="kind-label">Klassifisering</span>
      <div class="kind-seg">
        <label class="kind-seg-opt" :class="{ active: nodeKind === 'incident' }">
          <input type="radio" value="incident" :checked="nodeKind === 'incident'" @change="flipKind('incident')" />
          Hendelse
        </label>
        <label class="kind-seg-opt" :class="{ active: nodeKind === 'operation' }">
          <input type="radio" value="operation" :checked="nodeKind === 'operation'" @change="flipKind('operation')" />
          Operasjon
        </label>
      </div>
      <span v-if="kindError" class="kind-error">{{ kindError }}</span>
    </div>

    <div v-if="loading" class="status">Laster hendelse…</div>
    <div v-else-if="error" class="status error">Hendelsen ble ikke funnet.</div>

    <template v-else-if="event || neoEvent">
      <!-- Timeline.js section -->
      <section class="timeline-section">
        <h2 class="timeline-heading">Tidslinjeutforsker</h2>
        <div class="timeline-filters">
          <select class="filter-select">
            <option>Alle Organisasjoner</option>
          </select>
          <select class="filter-select">
            <option>Alle Avdelinger</option>
          </select>
        </div>
        <div class="timeline-placeholder">
          <!-- Timeline.js widget — implement when TimelineView is built -->
        </div>
      </section>

      <hr class="divider" />

      <!-- Admin: event scalar editor -->
      <section v-if="isAdmin && nodeKind" class="edit-section">
        <h3 class="edit-section-heading">{{ nodeKind === 'operation' ? 'Operasjon' : 'Hendelse' }}</h3>
        <div class="edit-row">
          <label class="edit-label" for="edit-name">{{ nodeKind === 'operation' ? 'Kodenavn' : 'Tittel' }}</label>
          <input id="edit-name" v-model="editForm.name" class="edit-input" type="text" />
        </div>
        <div class="edit-row">
          <label class="edit-label" for="edit-date">Dato</label>
          <input
            id="edit-date"
            v-model="editForm.date"
            class="edit-input edit-input-date"
            type="text"
            placeholder="YYYY-MM-DD"
          />
        </div>
        <footer v-if="editDirty" class="edit-save-bar">
          <span class="edit-save-prompt">Ser det bra ut?</span>
          <button type="button" class="edit-btn-primary" :disabled="editSaving" @click="saveEdit">
            {{ editSaving ? 'Lagrer…' : 'Lagre' }}
          </button>
          <button type="button" class="edit-link-revert" :disabled="editSaving" @click="revertEdit">Angre</button>
        </footer>
        <div v-if="editError" class="edit-save-error">{{ editError }}</div>
      </section>

      <!-- Article -->
      <article class="article">
        <h2 class="event-title">{{ displayName }}</h2>
        <p v-if="displayDate" class="event-date">{{ displayDate }}</p>

        <!-- Beskrivelse -->
        <section v-if="descriptionHtml" class="section">
          <h2 class="section-heading">Beskrivelse</h2>
          <!-- eslint-disable vue/no-v-html -->
          <div
            class="portable-text"
            @click.capture="handleInternalLinks"
            v-html="descriptionHtml"
          ></div>
          <!-- eslint-enable vue/no-v-html -->
        </section>

        <!-- Fra Sted -->
        <section v-if="displayLocationFrom" class="section">
          <h2 class="section-heading">Fra Sted</h2>
          <RouterLink :to="`/map/${displayLocationFrom.slug}`" class="section-link">
            {{ displayLocationFrom.title }}
          </RouterLink>
        </section>

        <!-- Til Sted -->
        <section v-if="displayLocationTo" class="section">
          <h2 class="section-heading">Til Sted</h2>
          <RouterLink :to="`/map/${displayLocationTo.slug}`" class="section-link">
            {{ displayLocationTo.title }}
          </RouterLink>
        </section>

        <!-- Fra Base -->
        <section v-if="displayStationFrom || displayStationTo" class="section">
          <h2 class="section-heading">Fra Base</h2>
          <RouterLink v-if="displayStationFrom" :to="`/station/${displayStationFrom.slug}`" class="section-link">
            {{ displayStationFrom.title }}
          </RouterLink>
          <RouterLink v-if="displayStationTo" :to="`/station/${displayStationTo.slug}`" class="section-link">
            {{ displayStationTo.title }}
          </RouterLink>
        </section>

        <!-- Deltakere -->
        <section v-if="displayPeople.length" class="section">
          <h2 class="section-heading">Deltakere</h2>
          <div class="people-list">
            <RouterLink
              v-for="person in displayPeople"
              :key="person.slug"
              :to="`/person/${person.slug}`"
              class="section-link"
            >
              {{ person.name }}
            </RouterLink>
          </div>
        </section>

        <!-- Transportmiddel (Sanity-only for now) -->
        <section v-if="event?.transport?.length" class="section">
          <h2 class="section-heading">Transportmiddel</h2>
          <div class="transport-list">
            <RouterLink
              v-for="t in event.transport"
              :key="t.slug"
              :to="`/transport/${t.slug}`"
              class="section-link"
            >
              {{ t.name }}
            </RouterLink>
          </div>
        </section>

        <!-- Galleri -->
        <section v-if="displayGallery.length" class="section">
          <h2 class="section-heading">Galleri</h2>
          <div class="carousel">
            <button
              v-if="displayGallery.length > 1"
              class="carousel-btn carousel-prev"
              @click="prevImage"
            >
              &#x2039;
            </button>
            <img
              :src="currentImageUrl"
              :alt="`${displayName} bilde ${currentImageIndex + 1}`"
              class="carousel-img"
            />
            <button
              v-if="displayGallery.length > 1"
              class="carousel-btn carousel-next"
              @click="nextImage"
            >
              &#x203a;
            </button>
          </div>
          <p v-if="displayGallery.length > 1" class="carousel-count">
            {{ currentImageIndex + 1 }} / {{ displayGallery.length }}
          </p>
        </section>

        <!-- Nyttige lenker (Sanity-only for now) -->
        <section v-if="event?.links?.length" class="section">
          <h2 class="section-heading">Nyttige lenker</h2>
          <div class="links-list">
            <a
              v-for="link in event.links"
              :key="link.link"
              :href="link.link"
              target="_blank"
              rel="noopener noreferrer"
              class="ext-link"
            >{{ link.title || link.link }} <span class="ext-icon">↗</span></a>
          </div>
        </section>

        <RelationListEditor
          v-if="isAdmin && nodeKind"
          :parent-slug="(route.params.slug as string)"
          :entries="personEntries"
          :targets="personTargets"
          :strategy="personStrategy"
          :label="personLabel"
          add-label="+ Legg til person"
          empty-label="Ingen personer knyttet"
          search-placeholder="Søk person…"
          picker-chip-aria="Bytt person"
          validation-empty="Velg person for alle oppføringer før du lagrer."
          :show-dates="false"
        />

        <RelationListView
          :entries="personEntries"
          :strategy="personStrategy"
          :label="personLabel"
          @open="e => (activePerson = e)"
        />

        <RelationInfoPopup :entry="activePerson" @close="activePerson = null" />

        <!-- Hierarchy editors — admin only -->
        <RelationListEditor
          v-if="isAdmin && nodeKind === 'incident'"
          :parent-slug="(route.params.slug as string)"
          :entries="subIncidentEntries"
          :targets="subIncidentTargets"
          :strategy="SubIncidentsStrategy"
          label="Underhendelser"
          add-label="+ Legg til underhendelse"
          empty-label="Ingen underhendelser"
          search-placeholder="Søk hendelse…"
          picker-chip-aria="Bytt hendelse"
          validation-empty="Velg hendelse for alle oppføringer før du lagrer."
          :show-dates="false"
          :show-description="false"
        />

        <RelationListEditor
          v-if="isAdmin && nodeKind === 'operation'"
          :parent-slug="(route.params.slug as string)"
          :entries="opIncidentEntries"
          :targets="opIncidentTargets"
          :strategy="OperationIncidentsStrategy"
          label="Hendelser i operasjonen"
          add-label="+ Legg til hendelse"
          empty-label="Ingen hendelser knyttet"
          search-placeholder="Søk hendelse…"
          picker-chip-aria="Bytt hendelse"
          validation-empty="Velg hendelse for alle oppføringer før du lagrer."
          :show-dates="false"
          :show-description="false"
        />

        <RelationListEditor
          v-if="isAdmin && nodeKind === 'operation'"
          :parent-slug="(route.params.slug as string)"
          :entries="subOperationEntries"
          :targets="subOperationTargets"
          :strategy="SubOperationsStrategy"
          label="Deloperasjoner"
          add-label="+ Legg til deloperasjon"
          empty-label="Ingen deloperasjoner"
          search-placeholder="Søk operasjon…"
          picker-chip-aria="Bytt operasjon"
          validation-empty="Velg operasjon for alle oppføringer før du lagrer."
          :show-dates="false"
          :show-description="false"
        />
      </article>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, inject, watch } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { fetchEventDetailBySlug } from '../composables/useLocationCache.ts'
import { useAuth, authFetch } from '../composables/useAuth.ts'
import { useEventData, type EventKind } from '../composables/useEventData.ts'
import { EventDataKey } from '../composables/proposalDataInjection.ts'
import { SANITY_IMG } from '../config/sanity.ts'
import { blocksToHtml } from '../utils/portableText.ts'
import type { IdbEventDetail } from '../types/idb.ts'
import RelationListEditor from '../components/relation/RelationListEditor.vue'
import RelationListView   from '../components/relation/RelationListView.vue'
import RelationInfoPopup  from '../components/relation/RelationInfoPopup.vue'
import {
  PersonInvolvementStrategy, PersonParticipationStrategy,
} from '../components/relation/strategies.ts'
import type { RelationEntry } from '../components/relation/RelationStrategy.ts'

const route = useRoute()
const router = useRouter()
const event = ref<IdbEventDetail | null>(null)
const loading = ref(true)
const error = ref(false)
const currentImageIndex = ref(0)

const { user } = useAuth()
const isAdmin  = computed(() => user.value?.role === 'admin')

// Neo4j data layer — live by default, swappable to a proposal-wrapped
// composable when EventDataKey is provided (proposal preview modal).
const eventData = inject(EventDataKey, () => useEventData(), true)
const {
  event: neoEvent,
  savedSections,
  personEntries, personTargets,
  subIncidentEntries, subIncidentTargets,
  subOperationEntries, subOperationTargets,
  opIncidentEntries, opIncidentTargets,
  loadEvent,
} = eventData

type NodeKind = EventKind
const nodeKind  = computed<NodeKind | null>(() => neoEvent.value?.kind ?? null)
const kindError = ref<string | null>(null)
const activePerson = ref<RelationEntry | null>(null)

const personLabel = computed(() =>
  nodeKind.value === 'operation' ? 'Deltakere' : 'Involverte personer',
)
const personStrategy = computed(() =>
  nodeKind.value === 'operation' ? PersonParticipationStrategy : PersonInvolvementStrategy,
)

// Seed editForm whenever the Neo4j event refreshes.
watch(neoEvent, (e) => {
  if (e) {
    editForm.value     = { name: e.canonicalName, date: e.date ?? '' }
    editOriginal.value = { ...editForm.value }
  }
}, { immediate: true })

const { locationFrom, locationTo, stationFrom, stationTo, gallery: neoGallery } = eventData

// Prefer Neo4j edges; fall back to Sanity-IDB if Neo4j hasn't materialized.
const displayLocationFrom = computed(() => locationFrom.value ?? event.value?.locationFrom ?? null)
const displayLocationTo   = computed(() => locationTo.value   ?? event.value?.locationTo   ?? null)
const displayStationFrom  = computed(() => stationFrom.value  ?? event.value?.stationFrom  ?? null)
const displayStationTo    = computed(() => stationTo.value    ?? event.value?.stationTo    ?? null)
const displayPeople = computed(() =>
  personEntries.value.length
    ? personEntries.value.map((p) => ({ slug: p.targetSlug, name: p.targetName }))
    : (event.value?.people ?? []),
)
const displayGallery = computed(() =>
  neoGallery.value.length
    ? neoGallery.value.map((g) => ({ url: g.url, caption: g.caption, asset: null }))
    : (event.value?.gallery ?? []).map((g) => ({
        url:     null,
        caption: g.caption ?? null,
        asset:   g.asset,
      })),
)
const descriptionHtml = computed<string>(() => {
  if (savedSections.value.length) {
    const parts: string[] = []
    for (const s of savedSections.value) {
      if (!s.content) continue
      try {
        const blocks = JSON.parse(s.content) as unknown[]
        parts.push(blocksToHtml(blocks as Parameters<typeof blocksToHtml>[0]))
      } catch { /* skip */ }
    }
    return parts.join('')
  }
  return event.value?.description ? blocksToHtml(event.value.description) : ''
})

interface EditForm { name: string; date: string }
const editForm     = ref<EditForm>({ name: '', date: '' })
const editOriginal = ref<EditForm>({ name: '', date: '' })
const editSaving   = ref(false)
const editError    = ref<string | null>(null)
const editDirty    = computed(() =>
  editForm.value.name !== editOriginal.value.name || editForm.value.date !== editOriginal.value.date,
)

function revertEdit() {
  editForm.value = { ...editOriginal.value }
  editError.value = null
}

async function saveEdit() {
  const slug = String(route.params.slug)
  if (!slug) return
  const body: Record<string, unknown> = {}
  if (editForm.value.name !== editOriginal.value.name) body.name = editForm.value.name.trim()
  if (editForm.value.date !== editOriginal.value.date) body.date = editForm.value.date.trim() || null
  if (!Object.keys(body).length) return
  editSaving.value = true
  editError.value = null
  try {
    const res = await authFetch(`/api/admin/event/${encodeURIComponent(slug)}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    const out = await res.json().catch(() => ({})) as { name?: string; date?: string | null; error?: string }
    if (!res.ok) {
      editError.value = out.error ?? `HTTP ${res.status}`
      return
    }
    editOriginal.value = { name: out.name ?? editForm.value.name, date: out.date ?? '' }
    editForm.value = { ...editOriginal.value }
  } catch (e) {
    editError.value = (e as Error).message
  } finally {
    editSaving.value = false
  }
}

/** Live preview overlay — show draft values in the article header while dirty. */
const displayName = computed(() =>
  editDirty.value
    ? editForm.value.name
    : (editOriginal.value.name || neoEvent.value?.canonicalName || event.value?.title || ''),
)
const displayDate = computed(() =>
  editDirty.value
    ? editForm.value.date
    : (editOriginal.value.date || neoEvent.value?.date || ''),
)

async function flipKind(target: NodeKind) {
  const slug = String(route.params.slug)
  if (!slug || nodeKind.value === target) return
  const label = target === 'operation' ? 'Operasjon' : 'Hendelse'
  if (!window.confirm(
    `Endre klassifisering til ${label}? Dette skriver om edges (INVOLVED_IN/PARTICIPATED_IN, notater, hierarki).`,
  )) return
  kindError.value = null
  try {
    const res = await authFetch(`/api/admin/event/${encodeURIComponent(slug)}/kind`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ kind: target }),
    })
    const body = await res.json().catch(() => ({})) as { kind?: NodeKind; error?: string }
    if (!res.ok) {
      kindError.value = body.error ?? `HTTP ${res.status}`
      return
    }
    await loadEvent(slug)
  } catch (e) {
    kindError.value = (e as Error).message
  }
}

const currentImageUrl = computed<string>(() => {
  const g = displayGallery.value
  if (!g.length) return ''
  const item = g[currentImageIndex.value]
  if (item.url) return item.url
  if (item.asset && '_ref' in item.asset) {
    const path = (item.asset as { _ref: string })._ref
      .replace(/^image-/, '').replace(/-([a-z]+)$/, '.$1')
    return `${SANITY_IMG}/${path}?w=900&auto=format`
  }
  return ''
})

function prevImage() {
  const len = displayGallery.value.length
  if (!len) return
  currentImageIndex.value = (currentImageIndex.value - 1 + len) % len
}

function nextImage() {
  const len = displayGallery.value.length
  if (!len) return
  currentImageIndex.value = (currentImageIndex.value + 1) % len
}

function handleInternalLinks(e: MouseEvent) {
  const link = (e.target as HTMLElement).closest('a.internal-link')
  if (link) {
    e.preventDefault()
    void router.push(link.getAttribute('href') ?? '/')
  }
}

onMounted(async () => {
  const slug = route.params.slug as string
  // Run Neo4j load in parallel; let the Sanity fetch fail independently
  // (the slug may be Neo4j-only with no Sanity counterpart).
  const [sanityResult] = await Promise.allSettled([
    fetchEventDetailBySlug(slug),
    loadEvent(slug),
  ])
  if (sanityResult.status === 'fulfilled') event.value = sanityResult.value
  if (!event.value && !neoEvent.value) error.value = true
  loading.value = false
})
</script>

<style scoped>
.event-page {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: var(--paper);
}

/* ── Admin scalar editor ─────────────────────────────────── */
.edit-section {
  margin: 0 16px 16px;
  padding: 16px;
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: 6px;
}
.edit-section-heading {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  margin: 0 0 12px;
}
.edit-row {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 12px;
  align-items: center;
  margin-bottom: 10px;
}
.edit-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink);
}
.edit-input {
  width: 100%;
  padding: 8px 10px;
  font-size: 14px;
  color: var(--ink);
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: 4px;
  box-sizing: border-box;
  font-family: inherit;
}
.edit-input:focus {
  outline: 2px solid var(--focus);
  outline-offset: -1px;
  border-color: var(--focus);
}
.edit-input-date { font-family: monospace; font-size: 12px; max-width: 160px; }
.edit-save-bar {
  margin-top: 12px;
  padding: 10px 14px;
  background: #fef3c7;
  border: 1px solid #fcd34d;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.edit-save-prompt { flex: 1; font-size: 13px; color: #92400e; font-weight: 600; }
.edit-btn-primary {
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 600;
  background: var(--focus);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
.edit-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.edit-link-revert {
  background: transparent;
  border: none;
  padding: 0;
  font-size: 12px;
  color: #92400e;
  text-decoration: underline;
  cursor: pointer;
}
.edit-link-revert:disabled { opacity: 0.5; cursor: not-allowed; }
.edit-save-error {
  margin-top: 8px;
  padding: 8px 10px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  font-size: 12px;
  color: #b91c1c;
}
.event-date {
  font-family: monospace;
  font-size: 13px;
  color: var(--muted);
  margin: -4px 0 16px;
}

/* ── Kind toggle (admin) ─────────────────────────────────── */
.kind-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  margin: 0 16px 12px;
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: 6px;
  font-size: 12px;
}
.kind-label {
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
  font-size: 11px;
}
.kind-seg {
  display: inline-flex;
  border: 1px solid var(--rule);
  border-radius: 4px;
  overflow: hidden;
}
.kind-seg-opt {
  display: inline-flex;
  align-items: center;
  padding: 6px 14px;
  font-size: 13px;
  color: var(--muted);
  cursor: pointer;
  user-select: none;
}
.kind-seg-opt + .kind-seg-opt { border-left: 1px solid var(--rule); }
.kind-seg-opt input[type="radio"] {
  position: absolute;
  width: 1px; height: 1px;
  opacity: 0;
  pointer-events: none;
}
.kind-seg-opt.active {
  background: var(--focus);
  color: #fff;
  font-weight: 600;
}
.kind-error {
  color: #b91c1c;
  font-size: 12px;
  margin-left: 8px;
}

/* ── Back ─────────────────────────────────────────────────── */
.back-btn {
  background: none;
  border: none;
  font-size: 13px;
  font-weight: 600;
  color: var(--focus);
  cursor: pointer;
  padding: 12px 16px;
  display: block;
}

/* ── Status ───────────────────────────────────────────────── */
.status {
  padding: 48px 24px;
  text-align: center;
  font-size: 13px;
  color: var(--muted);
}
.error { color: var(--faded-red); }

/* ── Timeline section ─────────────────────────────────────── */
.timeline-section {
  padding: 16px 16px 0;
}

.timeline-heading {
  font-size: 16px;
  font-weight: 700;
  color: var(--ink);
  margin: 0 0 10px;
}

.timeline-filters {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.filter-select {
  font-size: 13px;
  padding: 4px 8px;
  border: 1px solid var(--rule);
  border-radius: 4px;
  background: var(--paper-raised);
  color: var(--ink);
  cursor: pointer;
}

.timeline-placeholder {
  width: 100%;
  height: 180px;
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: 6px;
  margin-bottom: 16px;
}

/* ── Divider ──────────────────────────────────────────────── */
.divider {
  border: none;
  border-top: 1px solid var(--rule);
  margin: 0;
}

/* ── Article ──────────────────────────────────────────────── */
.article {
  padding: 16px 16px 40px;
  max-width: 720px;
}

.event-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--ink);
  margin: 0 0 8px;
  line-height: 1.3;
}

/* ── Section ──────────────────────────────────────────────── */
.section {
  border-top: 0.5px solid var(--rule);
  padding: 14px 0;
}

.section-heading {
  font-size: 13px;
  font-weight: 700;
  color: var(--muted);
  margin: 0 0 8px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* ── Portable text ────────────────────────────────────────── */
.portable-text :deep(p) {
  margin: 0 0 0.75em;
  font-size: 14px;
  line-height: 1.75;
  color: var(--ink);
  white-space: pre-line;
}

.portable-text :deep(p:last-child) { margin-bottom: 0; }

.portable-text :deep(pre.pre-table) {
  font-family: 'Courier New', Courier, monospace;
  font-size: 11px;
  tab-size: 4;
  white-space: pre-wrap;
  overflow-x: auto;
  background: color-mix(in srgb, var(--rule) 50%, var(--paper-raised));
  border-radius: 3px;
  padding: 8px 10px;
  line-height: 1.65;
  color: var(--ink);
  margin: 0 0 0.75em;
}

.portable-text :deep(strong) {
  font-weight: 600;
  color: var(--ink);
}

.portable-text :deep(u) { text-decoration: underline; }
.portable-text :deep(em) { font-style: italic; }

.portable-text :deep(a.internal-link),
.portable-text :deep(a.external-link) {
  color: var(--focus);
  text-decoration: underline;
  cursor: pointer;
}

.portable-text :deep(a.external-link::after) {
  content: ' ↗';
  font-size: 11px;
  opacity: 0.6;
}

/* ── Section links ────────────────────────────────────────── */
.section-link {
  display: block;
  font-size: 13px;
  color: var(--focus);
  text-decoration: none;
  padding: 2px 0;
}

.section-link:hover { text-decoration: underline; }

.people-list,
.transport-list,
.links-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* ── Carousel ─────────────────────────────────────────────── */
.carousel {
  display: flex;
  align-items: center;
  gap: 8px;
}

.carousel-img {
  flex: 1;
  width: 100%;
  max-height: 360px;
  object-fit: contain;
  display: block;
  border-radius: 4px;
  background: var(--rule);
}

.carousel-btn {
  background: none;
  border: 1px solid var(--rule);
  border-radius: 50%;
  width: 32px;
  height: 32px;
  font-size: 20px;
  color: var(--focus);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  line-height: 1;
}

.carousel-btn:hover { border-color: var(--rule); }

.carousel-count {
  font-size: 11px;
  color: var(--muted);
  text-align: center;
  margin: 6px 0 0;
}

/* ── External links ───────────────────────────────────────── */
.ext-link {
  font-size: 13px;
  color: var(--focus);
  text-decoration: none;
  padding: 2px 0;
  word-break: break-all;
}

.ext-link:hover { text-decoration: underline; }

.ext-icon {
  font-size: 11px;
  opacity: 0.6;
}
</style>
