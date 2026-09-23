<template>
  <div class="event-page">
    <button class="back-btn" @click="router.back()">&#x2039; Tilbake</button>

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

      <!-- Admin: full edit pane (scalar + description + relations) -->
      <EventEditPane
        v-if="isAdmin && neoEvent"
        :event="neoEvent"
        :saved-sections="savedSections"
        :data="relationsData"
        :demote-blockers="demoteBlockers"
        @saved-scalar="onSavedScalar"
        @kind-flipped="() => loadEvent(String(route.params.slug))"
        @slug-changed="onSlugChanged"
        @saved-sections="sections => savedSections = sections"
      />

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
          <RouterLink :to="placeRoute(displayLocationFrom.slug)" class="section-link">
            {{ displayLocationFrom.title }}
          </RouterLink>
        </section>

        <!-- Til Sted -->
        <section v-if="displayLocationTo" class="section">
          <h2 class="section-heading">Til Sted</h2>
          <RouterLink :to="placeRoute(displayLocationTo.slug)" class="section-link">
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

        <!-- Non-admin: read-only people list (admin uses EventEditPane above) -->
        <RelationListView
          v-if="!isAdmin"
          :entries="personEntries"
          :strategy="personStrategy"
          :label="personLabel"
          @open="e => (activePerson = e)"
        />

        <RelationInfoPopup :entry="activePerson" @close="activePerson = null" />
      </article>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, inject } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { fetchEventDetailBySlug } from '../composables/useLocationCache.ts'
import { useAuth } from '../composables/useAuth.ts'
import { usePlaceRoute } from '../composables/usePlaceRoute.ts'
import { useEventData } from '../composables/useEventData.ts'
import { EventDataKey } from '../composables/proposalDataInjection.ts'
import { SANITY_IMG } from '../config/sanity.ts'
import { blocksToHtml } from '../utils/portableText.ts'
import type { IdbEventDetail } from '../types/idb.ts'
import RelationListView   from '../components/relation/RelationListView.vue'
import RelationInfoPopup  from '../components/relation/RelationInfoPopup.vue'
import {
  PersonInvolvementStrategy, PersonParticipationStrategy,
} from '../components/relation/strategies.ts'
import type { RelationEntry } from '../components/relation/RelationStrategy.ts'
import EventEditPane from '../components/event/EventEditPane.vue'
import type { EventRelationsData } from '../components/event/EventRelations.vue'

const route = useRoute()
const router = useRouter()
const event = ref<IdbEventDetail | null>(null)
const loading = ref(true)
const error = ref(false)
const currentImageIndex = ref(0)

const { user } = useAuth()
const isAdmin  = computed(() => user.value?.role === 'admin')
const placeRoute = usePlaceRoute()

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
  inOperationEntries, inOperationTargets,
  orgEntries, orgTargets,
  unitEntries, unitTargets,
  fromLocationEntries, fromLocationTargets,
  toLocationEntries,   toLocationTargets,
  fromStationEntries,  fromStationTargets,
  toStationEntries,    toStationTargets,
  atLocationEntries,   atLocationTargets,
  atStationEntries,    atStationTargets,
  demoteBlockers,
  loadEvent,
} = eventData

const activePerson = ref<RelationEntry | null>(null)

const personLabel = computed(() =>
  neoEvent.value?.kind === 'operation' ? 'Deltakere' : 'Involverte personer',
)
const personStrategy = computed(() =>
  neoEvent.value?.kind === 'operation' ? PersonParticipationStrategy : PersonInvolvementStrategy,
)

const { locationFrom, locationTo, stationFrom, stationTo, gallery: neoGallery } = eventData

const relationsData = computed<EventRelationsData>(() => ({
  person:       { entries: personEntries.value,       targets: personTargets.value       },
  subIncident:  { entries: subIncidentEntries.value,  targets: subIncidentTargets.value  },
  subOperation: { entries: subOperationEntries.value, targets: subOperationTargets.value },
  opIncident:   { entries: opIncidentEntries.value,   targets: opIncidentTargets.value   },
  inOperation:  { entries: inOperationEntries.value,  targets: inOperationTargets.value  },
  org:          { entries: orgEntries.value,           targets: orgTargets.value          },
  unit:         { entries: unitEntries.value,          targets: unitTargets.value         },
  fromLocation: { entries: fromLocationEntries.value,  targets: fromLocationTargets.value },
  toLocation:   { entries: toLocationEntries.value,    targets: toLocationTargets.value   },
  fromStation:  { entries: fromStationEntries.value,   targets: fromStationTargets.value  },
  toStation:    { entries: toStationEntries.value,     targets: toStationTargets.value    },
  atLocation:   { entries: atLocationEntries.value,    targets: atLocationTargets.value   },
  atStation:    { entries: atStationEntries.value,     targets: atStationTargets.value    },
}))

function onSavedScalar(out: { name?: string; date?: string | null }) {
  if (neoEvent.value) {
    if (out.name != null) neoEvent.value.canonicalName = out.name
    if (out.date !== undefined) neoEvent.value.date = out.date ?? null
  }
}

async function onSlugChanged(newSlug: string) {
  // Replace the URL silently and re-load the event under the new slug so
  // all downstream queries (relations, sections, blockers) re-key.
  await router.replace(`/events/${encodeURIComponent(newSlug)}`)
  await loadEvent(newSlug)
}

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

const displayName = computed(() => neoEvent.value?.canonicalName || event.value?.title || '')
const displayDate = computed(() => neoEvent.value?.date || '')

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

.event-date {
  font-family: var(--font-mono);
  font-size: var(--size-label);
  color: var(--muted);
  margin: -4px 0 var(--space-md);
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
