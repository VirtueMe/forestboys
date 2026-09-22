<template>
  <div class="event-panel">
    <div class="panel-header">
      <p v-if="displayDate" class="event-date">{{ formatDate(displayDate) }}</p>
      <h2 class="event-title">{{ displayName }}</h2>
      <p v-if="meta" class="event-meta">{{ meta }}</p>
    </div>

    <AdminViewTabs
      v-if="isAdmin"
      v-model="mode"
      :proposal-count="bundlesPanel.openBundles.value.length"
    />

    <template v-if="mode === 'proposals' && bundlesPanel.currentBundle.value">
      <BundleReviewPanel
        :key="bundlesPanel.currentBundle.value.bundleId"
        :bundle-id="bundlesPanel.currentBundle.value.bundleId"
        :older-bundle="bundlesPanel.olderBundle.value"
        :newer-bundle="bundlesPanel.newerBundle.value"
        @deleted="bundlesPanel.onBundleDeleted"
        @navigate="bundlesPanel.onBundleNavigate"
      />
    </template>

    <EventEditPane
      v-else-if="mode === 'edit' && neoEvent"
      :event="neoEvent"
      :saved-sections="savedSections"
      :data="relationsData"
      :demote-blockers="demoteBlockers"
      @saved-scalar="onSavedScalar"
      @kind-flipped="() => loadEvent(props.event.slug)"
      @slug-changed="newSlug => emit('event-renamed', { from: props.event.slug, to: newSlug })"
      @saved-sections="sections => savedSections = sections"
    />

    <template v-else>
      <!-- Beskrivelse -->
      <section v-if="event.description?.length" class="section">
        <h3 class="section-heading">Beskrivelse</h3>
        <!-- eslint-disable vue/no-v-html -->
        <div
          class="portable-text"
          @click.capture="handleInternalLinks"
          v-html="blocksToHtml(event.description)"
        ></div>
        <!-- eslint-enable vue/no-v-html -->
      </section>

      <!-- Sted (incident: AT) / Fra Sted (operation: FROM) -->
      <section v-if="event.locationFrom" class="section">
        <h3 class="section-heading">{{ event.kind === 'operation' ? 'Fra Sted' : 'Sted' }}</h3>
        <RouterLink :to="`/map/${event.locationFrom.slug}`" class="section-link">
          {{ event.locationFrom.title }}
        </RouterLink>
      </section>

      <!-- Til Sted — operation only -->
      <section v-if="event.kind === 'operation' && event.locationTo" class="section">
        <h3 class="section-heading">Til Sted</h3>
        <RouterLink :to="`/map/${event.locationTo.slug}`" class="section-link">
          {{ event.locationTo.title }}
        </RouterLink>
      </section>

      <!-- Base (incident: AT_STATION) / Stasjoner (operation: FROM/TO_STATION) -->
      <section v-if="event.stationFrom || event.stationTo" class="section">
        <h3 class="section-heading">{{
          event.kind === 'operation'
            ? (event.stationFrom && event.stationTo ? 'Stasjoner' : (event.stationFrom ? 'Fra Base' : 'Til Base'))
            : 'Base'
        }}</h3>
        <RouterLink v-if="event.stationFrom" :to="`/station/${event.stationFrom.slug}`" class="section-link">
          {{ event.stationFrom.title }}
        </RouterLink>
        <RouterLink v-if="event.kind === 'operation' && event.stationTo" :to="`/station/${event.stationTo.slug}`" class="section-link">
          {{ event.stationTo.title }}
        </RouterLink>
      </section>

      <!-- Deltakere -->
      <section v-if="event.people?.length" class="section">
        <h3 class="section-heading">Deltakere</h3>
        <div class="link-list">
          <RouterLink
            v-for="person in event.people"
            :key="person.slug"
            :to="`/person/${person.slug}`"
            class="section-link"
          >
            {{ person.name }}
          </RouterLink>
        </div>
      </section>

      <!-- Transportmiddel -->
      <section v-if="event.transport?.length" class="section">
        <h3 class="section-heading">Transportmiddel</h3>
        <div class="link-list">
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

      <!-- Galleri (images still served from Sanity by asset ref) -->
      <section v-if="event.gallery?.length" class="section">
        <h3 class="section-heading">Galleri</h3>
        <div class="carousel">
          <button v-if="event.gallery.length > 1" class="carousel-btn" @click="prevImage">&#x2039;</button>
          <img :src="currentImageUrl" :alt="`${event.title} bilde ${currentImageIndex + 1}`" class="carousel-img" />
          <button v-if="event.gallery.length > 1" class="carousel-btn" @click="nextImage">&#x203a;</button>
        </div>
        <p v-if="currentImageCaption" class="carousel-caption">{{ currentImageCaption }}</p>
        <p v-if="event.gallery.length > 1" class="carousel-count">
          {{ currentImageIndex + 1 }} / {{ event.gallery.length }}
        </p>
      </section>

      <!-- Nyttige lenker -->
      <section v-if="event.links?.length" class="section">
        <h3 class="section-heading">Nyttige lenker</h3>
        <div class="link-list">
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
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { SANITY_IMG } from '../config/sanity.ts'
import { blocksToHtml } from '../utils/portableText.ts'
import type { IdbEventDetail } from '../types/idb.ts'
import AdminViewTabs, { type AdminViewMode } from './AdminViewTabs.vue'
import BundleReviewPanel from './BundleReviewPanel.vue'
import EventEditPane from './event/EventEditPane.vue'
import type { EventRelationsData } from './event/EventRelations.vue'
import { useAuth } from '../composables/useAuth.ts'
import { useEventData } from '../composables/useEventData.ts'
import { useEntityBundles } from '../composables/useEntityBundles.ts'

const props = defineProps<{ event: IdbEventDetail }>()
const emit  = defineEmits<{
  'select-event-slug': [slug: string]
  'select-date':       [date: string]
  // Rename, not navigation: the parent must re-key its caches before the
  // URL changes, or the new slug resolves to nothing.
  'event-renamed':     [move: { from: string; to: string }]
}>()

const { user } = useAuth()
const isAdmin = computed(() => user.value?.role === 'admin')

// Neo4j event data — used for the edit form + Forslag tab. EventsView
// loads detail via fetchEventDetailFromNeo4j into the `event` prop, so
// the live page already has the basics; this composable's loadEvent
// re-fetches richer relation context for editing.
const eventData = useEventData()
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
watch(() => props.event.slug, (slug) => { if (slug) void loadEvent(slug) }, { immediate: true })

const slugRef = computed(() => props.event.slug)
const bundlesPanel = useEntityBundles({
  kind: computed(() => neoEvent.value?.kind === 'operation' ? 'Operation' : 'Incident').value,
  slug: slugRef,
  isAdmin,
})

const mode = ref<AdminViewMode>('preview')

const relationsData = computed<EventRelationsData>(() => ({
  person:       { entries: personEntries.value,        targets: personTargets.value        },
  subIncident:  { entries: subIncidentEntries.value,   targets: subIncidentTargets.value   },
  subOperation: { entries: subOperationEntries.value,  targets: subOperationTargets.value  },
  opIncident:   { entries: opIncidentEntries.value,    targets: opIncidentTargets.value    },
  inOperation:  { entries: inOperationEntries.value,   targets: inOperationTargets.value   },
  org:          { entries: orgEntries.value,            targets: orgTargets.value           },
  unit:         { entries: unitEntries.value,           targets: unitTargets.value          },
  fromLocation: { entries: fromLocationEntries.value,   targets: fromLocationTargets.value  },
  toLocation:   { entries: toLocationEntries.value,     targets: toLocationTargets.value    },
  fromStation:  { entries: fromStationEntries.value,    targets: fromStationTargets.value   },
  toStation:    { entries: toStationEntries.value,      targets: toStationTargets.value     },
  atLocation:   { entries: atLocationEntries.value,     targets: atLocationTargets.value    },
  atStation:    { entries: atStationEntries.value,      targets: atStationTargets.value     },
}))

function onSavedScalar(out: { name?: string; date?: string | null }) {
  if (neoEvent.value) {
    if (out.name != null) neoEvent.value.canonicalName = out.name
    if (out.date !== undefined) neoEvent.value.date = out.date ?? null
  }
}

const displayName = computed(() => neoEvent.value?.canonicalName || props.event.title)
const displayDate = computed(() => neoEvent.value?.date || props.event.date || '')

const meta = computed(() => {
  const parts: string[] = []
  if (props.event.organization) parts.push(props.event.organization)
  if (props.event.district) parts.push(props.event.district)
  return parts.join(' · ') || null
})

const MONTHS = ['januar','februar','mars','april','mai','juni','juli','august','september','oktober','november','desember']

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d}. ${MONTHS[m - 1]} ${y}`
}

// ── Gallery carousel ───────────────────────────────────────────
const router = useRouter()
const currentImageIndex = ref(0)
watch(() => props.event.slug, () => { currentImageIndex.value = 0 })

interface GalleryItem { asset?: { _ref?: string }; url?: string | null; caption?: string | null }
function imageUrl(img: GalleryItem | undefined): string {
  if (!img) return ''
  if (img.url) return img.url
  const ref = img.asset?._ref ?? ''
  if (!ref) return ''
  const path = ref.replace(/^image-/, '').replace(/-([a-z]+)$/, '.$1')
  return `${SANITY_IMG}/${path}?w=900&auto=format`
}
const currentImageUrl     = computed(() => imageUrl(props.event.gallery?.[currentImageIndex.value] as GalleryItem))
const currentImageCaption = computed(() => (props.event.gallery?.[currentImageIndex.value] as GalleryItem | undefined)?.caption ?? '')

function prevImage() {
  const len = props.event.gallery?.length ?? 0
  if (!len) return
  currentImageIndex.value = (currentImageIndex.value - 1 + len) % len
}
function nextImage() {
  const len = props.event.gallery?.length ?? 0
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
</script>

<style scoped>
.event-panel {
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.panel-header {
  padding: var(--space-md) var(--space-lg) var(--space-sm);
  border-bottom: 1px solid var(--rule);
}

.event-date {
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--muted);
  margin: 0 0 var(--space-xs);
}

.event-title {
  font-family: var(--font-serif);
  font-size: var(--size-h3);
  font-weight: 600;
  color: var(--ink);
  margin: 0 0 var(--space-xs);
  line-height: 1.3;
}

.event-meta {
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--muted);
  margin: 0;
}

/* ── Section ──────────────────────────────────────────────── */
.section {
  border-top: 1px solid var(--rule);
  padding: var(--space-md) var(--space-lg);
}
.section-heading {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: var(--tracking-caps);
  color: var(--muted);
  margin: 0 0 var(--space-sm);
}

/* ── Portable text ────────────────────────────────────────── */
.portable-text :deep(p) {
  font-family: var(--font-serif);
  font-size: var(--size-body);
  line-height: 1.7;
  color: var(--ink);
  margin: 0 0 0.75em;
  white-space: pre-wrap;
}
.portable-text :deep(p:last-child) { margin-bottom: 0; }
.portable-text :deep(h1),
.portable-text :deep(h2),
.portable-text :deep(h3),
.portable-text :deep(h4),
.portable-text :deep(h5) {
  font-family: var(--font-serif);
  font-weight: 600;
  color: var(--ink);
  margin: 0.75em 0 0.4em;
}
.portable-text :deep(h1) { font-size: var(--size-h2); }
.portable-text :deep(h2) { font-size: var(--size-h3); }
.portable-text :deep(h3),
.portable-text :deep(h4),
.portable-text :deep(h5) { font-size: var(--size-body); }
.portable-text :deep(blockquote) {
  border-left: 3px solid var(--rule);
  margin: 0.75em 0;
  padding: 0.25em 0 0.25em 1em;
  color: var(--muted);
  font-style: italic;
}
.portable-text :deep(strong) { font-weight: 600; color: var(--ink); }
.portable-text :deep(em)     { font-style: italic; }
.portable-text :deep(u)      { text-decoration: underline; }
.portable-text :deep(a.internal-link),
.portable-text :deep(a.external-link) {
  color: var(--faded-red);
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}
.portable-text :deep(a.external-link::after) {
  content: ' ↗';
  font-size: 0.85em;
  opacity: 0.6;
}
.portable-text :deep(ul),
.portable-text :deep(ol) {
  margin: 0 0 0.75em 1.25em;
  padding: 0;
}
.portable-text :deep(li) {
  font-family: var(--font-serif);
  font-size: var(--size-body);
  line-height: 1.7;
  color: var(--ink);
  white-space: pre-wrap;
}

/* ── Links ────────────────────────────────────────────────── */
.link-list { display: flex; flex-direction: column; gap: var(--space-xs); }

.section-link {
  display: block;
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--faded-red);
  text-decoration: none;
  padding: 2px 0;
}
.section-link:hover { text-decoration: underline; }

.ext-link {
  display: block;
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--faded-red);
  text-decoration: none;
  padding: 2px 0;
  word-break: break-all;
}
.ext-link:hover { text-decoration: underline; }
.ext-icon { font-size: 0.85em; opacity: 0.6; }

/* ── Carousel ─────────────────────────────────────────────── */
.carousel {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.carousel-img {
  flex: 1;
  width: 100%;
  max-height: 320px;
  object-fit: contain;
  display: block;
  border-radius: var(--radius-md);
  background: var(--paper-sunken);
}
.carousel-btn {
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: 50%;
  width: 32px;
  height: 32px;
  font-size: 18px;
  color: var(--ink-soft);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  line-height: 1;
}
.carousel-btn:hover { color: var(--faded-red); border-color: var(--faded-red); }
.carousel-caption {
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--muted);
  text-align: center;
  margin: var(--space-sm) 0 0;
  font-style: italic;
}
.carousel-count {
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--muted);
  text-align: center;
  margin: var(--space-xs) 0 0;
}

</style>
