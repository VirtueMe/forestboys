<template>
  <AdminEventNewView v-if="isCreateMode" />
  <div v-else class="events-page">
    <!-- Filters — always visible; top row swaps between back link and search -->
    <div class="filters">
      <RouterLink v-if="isDetail" to="/events" class="back-link">&#x2039; Tilbake</RouterLink>
      <div class="search-row">
        <input
          v-model="searchQuery"
          class="search-input"
          type="search"
          placeholder="Søk etter hendelse…"
          autocomplete="off"
          spellcheck="false"
        />
        <button v-if="hasFilter" class="reset-btn" @click="resetFilters">Nullstill</button>
      </div>

      <select :value="org" :disabled="isDetail" class="filter-select" @change="setOrg(($event.target as HTMLSelectElement).value)">
        <option value="">Alle Organisasjoner</option>
        <option v-for="o in allOrgs" :key="o" :value="o">{{ o }}</option>
      </select>

      <CustomSelect
        :model-value="districts"
        :options="availableDistricts"
        :color-map="districtColorMap"
        placeholder="Alle Avdelinger"
        :multiple="true"
        @update:model-value="setDistricts($event as string[])"
      />
    </div>

    <!-- The link that brought you here named something that does not exist -->
    <div v-if="slugNotFound" class="notfound" role="status">
      <strong>Fant ikke «{{ slugNotFound }}».</strong>
      Lenken peker på noe som ikke finnes, eller som er skrevet på en måte vi ikke kjenner igjen. Her er alle hendelsene.
    </div>

    <!-- Timeline — always visible -->
    <div class="timeline-wrap">
      <EventTimeline
        :events="filteredEvents"
        :selected-slug="(route.params.slug as string | undefined) ?? ''"
        :hash-slug="eventHash(route.hash)"
        :color-for="e => (e.organization ? orgColor(e.organization) : '')"
        @select="slug => router.push({ path: `/events/${slug}`, query: route.query })"
      />
    </div>

    <!-- Detail panel -->
    <div v-if="isDetail" class="panels">
      <div v-if="loadingDetail" class="status">Laster hendelse…</div>
      <div v-else-if="detailError" class="status error">Hendelsen ble ikke funnet.</div>
      <EventPanel
        v-else-if="visibleDetail"
        :event="visibleDetail"
        class="panel"
        @select-event-slug="slug => router.push(`/events/${slug}`)"
        @event-renamed="({ from, to }) => { renameEvent(from, to); router.replace(`/events/${to}`) }"
        @select-date="openDateModal"
      />
    </div>

    <!-- Event list -->
    <template v-else>
      <div class="list-heading">
        <h1 class="list-label" aria-label="Hendelser">Hendelser ({{ fmt(filteredEvents.length) }})</h1>
      </div>

      <div
        ref="containerRef"
        class="scroll-container"
      >
        <div v-if="loading" class="status">Laster hendelser…</div>
        <div v-else-if="filteredEvents.length === 0" class="status">
          <span v-if="hasFilter">Ingen treff — prøv å justere filtrene.</span>
          <span v-else>Ingen hendelser funnet.</span>
        </div>
        <div v-else :style="{ height: totalHeight + 'px', position: 'relative' }">
          <div :style="{ transform: `translateY(${offsetY}px)` }">
            <RouterLink
              v-for="event in visibleEvents"
              :key="event.slug"
              :to="`/events/${event.slug}`"
              class="event-row"
            >
              <img
                v-if="event.thumbnailUrl"
                :src="`${event.thumbnailUrl?.replace(/\?.*$/, '')}?w=80&h=80&fit=crop&auto=format`"
                class="event-thumb"
                loading="lazy"
                alt=""
              />
              <span v-else class="event-thumb-placeholder"></span>
              <span class="event-date">{{ fmtDate(event.date) }}</span>
              <span class="event-title">{{ event.title }}</span>
              <span class="event-tags">
                <span
                  v-if="event.organization"
                  class="org-dot"
                  :style="{ background: orgColor(event.organization) }"
                ></span>
                <span class="event-meta">{{ rowMeta(event) }}</span>
              </span>
            </RouterLink>
          </div>
        </div>
      </div>
    </template>

    <!-- Date modal — outside v-if/v-else chain, teleports to body -->
    <AppModal v-model="dateModalOpen" :title="dateModalTitle">
      <DatePanel
        v-if="dateModalDate"
        :date="dateModalDate"
        @select-event-slug="slug => { dateModalOpen = false; router.push(`/events/${slug}`) }"
        @navigate="d => { dateModalDate = d }"
      />
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute, useRouter, RouterLink, onBeforeRouteUpdate } from 'vue-router'
import { eventHash, useEventsContext } from '../composables/useEventsContext.ts'
import EventPanel from '../components/EventPanel.vue'
import AppModal   from '../components/AppModal.vue'
import DatePanel  from '../components/DatePanel.vue'
import CustomSelect from '../components/CustomSelect.vue'
import AdminEventNewView from './AdminEventNewView.vue'
import EventTimeline from '../components/event/EventTimeline.vue'
import type { IdbEvent } from '../types/idb.ts'

const route  = useRoute()
const router = useRouter()

/** When the URL hash is `#new`, this page becomes the create form
 *  (mounting AdminEventNewView). The slug in the URL is a placeholder
 *  ('new'), and we skip the normal load + timeline init. */
const isCreateMode = computed(() => route.hash === '#new')

// ── Date modal ────────────────────────────────────────────────
const dateModalOpen  = ref(false)
const dateModalDate  = ref<string | null>(null)

const MONTHS = ['jan','feb','mar','apr','mai','jun','jul','aug','sep','okt','nov','des']
const dateModalTitle = computed(() => {
  if (!dateModalDate.value) return ''
  const [y, m, d] = dateModalDate.value.split('-').map(Number)
  return `${d}. ${MONTHS[m - 1]} ${y}`
})

function openDateModal(date: string) {
  dateModalDate.value = date
  dateModalOpen.value = true
}

const {
  loading, init,
  isDetail,
  org, districts, setOrg, setDistricts, availableDistricts, allOrgs,
  districtColorMap, searchQuery, hasFilter, resetFilters,
  filteredEvents, visibleDetail, loadingDetail, detailError, renameEvent, slugNotFound,
  orgColor,
} = useEventsContext()

// The timeline's height is fixed, but the list below it moves when the events change.
watch(filteredEvents, async () => {
  await nextTick()
  computeListOffset()
}, { flush: 'post' })

// ── Virtual scroll ────────────────────────────────────────────
const ITEM_HEIGHT = 56
const BUFFER      = 5
const scrollTop       = ref(0)
const containerHeight = ref(window.innerHeight)
const containerRef    = ref<HTMLElement | null>(null)
let listAbsoluteTop   = 0

function getPageContent(): HTMLElement | null {
  return document.querySelector('.page-content')
}

function computeListOffset() {
  const pc = getPageContent()
  if (!pc || !containerRef.value) return
  const pcRect        = pc.getBoundingClientRect()
  const containerRect = containerRef.value.getBoundingClientRect()
  listAbsoluteTop     = containerRect.top - pcRect.top + pc.scrollTop
}

function onPageScroll(e: Event) {
  const pc = e.currentTarget as HTMLElement
  scrollTop.value = Math.max(0, pc.scrollTop - listAbsoluteTop)
}

const visibleRange = computed(() => {
  const start = Math.max(0, Math.floor(scrollTop.value / ITEM_HEIGHT) - BUFFER)
  const end   = Math.min(
    filteredEvents.value.length,
    Math.ceil((scrollTop.value + containerHeight.value) / ITEM_HEIGHT) + BUFFER,
  )
  return { start, end }
})

const visibleEvents = computed(() => filteredEvents.value.slice(visibleRange.value.start, visibleRange.value.end))
const totalHeight   = computed(() => filteredEvents.value.length * ITEM_HEIGHT)
const offsetY       = computed(() => visibleRange.value.start * ITEM_HEIGHT)

watch([searchQuery, org, districts], async () => {
  scrollTop.value = 0
  const pc = getPageContent()
  if (pc) {
    await nextTick()
    computeListOffset()
    pc.scrollTop = listAbsoluteTop
  }
})

function fmtDate(iso: string | undefined): string {
  if (!iso) return '–'
  const [y, m, d] = iso.split('-')
  if (!y) return iso
  const date = new Date(Number(y), Number(m) - 1, Number(d))
  return date.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' })
}

function rowMeta(event: IdbEvent): string {
  return [event.organization, event.district].filter(Boolean).join(' · ')
}

function fmt(n: number): string {
  return n.toLocaleString('nb-NO')
}

// ── Lifecycle ─────────────────────────────────────────────────
let ro: ResizeObserver | null = null

onMounted(async () => {
  if (isCreateMode.value) return
  await init()
  const pc = getPageContent()
  if (pc) {
    await nextTick()
    computeListOffset()
    containerHeight.value = pc.clientHeight
    pc.addEventListener('scroll', onPageScroll)
    ro = new ResizeObserver(entries => {
      containerHeight.value = entries[0].contentRect.height
      computeListOffset()
    })
    ro.observe(pc)
  }
})

onBeforeRouteUpdate(async () => {
  await nextTick()
  computeListOffset()
})

onUnmounted(() => {
  getPageContent()?.removeEventListener('scroll', onPageScroll)
  ro?.disconnect()
})
</script>

<style scoped>
.events-page {
  display: flex;
  flex-direction: column;
  background: var(--paper);
  width: 100%;
}
/* Everything but the timeline stays in a centred column. The timeline is simply
 * 100% wide: no viewport units, which do not follow the app's CSS zoom (.shell
 * is zoomed from 1600 px up) and made the page overshoot and grow scrollbars. */
.events-page > :not(.timeline-wrap) {
  box-sizing: border-box;
  width: 100%;
  max-width: 1320px;
  margin-inline: auto;
}

/* ── Filters (/events) ──────────────────────────────────────── */
.filters {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  /* A strip of the page background between the filters and the timeline, so the
   * timeline clearly is not part of the filter block. */
  margin-bottom: 16px;
  background: var(--paper-raised);
  border-bottom: 1px solid var(--rule);
}

.search-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.filter-select {
  font-size: 13px;
  padding: 5px 10px;
  border: 1px solid var(--rule);
  border-radius: 6px;
  background: var(--paper);
  color: var(--ink);
  cursor: pointer;
  width: 100%;
}

/* ── Back link (inside filters, detail mode) ────────────────── */
.back-link {
  font-size: 13px;
  font-weight: 600;
  color: var(--focus);
  text-decoration: none;
}
.back-link:hover { text-decoration: underline; }

/* ── Not found (/events/<slug> that is no event) ─────────────── */
.notfound {
  margin-bottom: 16px;
  padding: 10px 12px;
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-left: 3px solid var(--faded-red);
  font-size: 13px;
  line-height: 1.45;
  color: var(--ink);
}

/* ── Timeline ───────────────────────────────────────────────── */
.timeline-wrap {
  flex-shrink: 0;
  border-bottom: 1px solid var(--rule);
  width: 100%;
}
/* ── Event panel (/events/:slug) ────────────────────────────── */
.panels {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 14px 32px;
}

.panel { width: 100%; }

/* ── List heading (/events) ─────────────────────────────────── */
.list-heading {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: 8px 14px;
  background: var(--paper-raised);
  border-bottom: 1px solid var(--rule);
}

.list-label {
  margin: 0;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--muted);
  white-space: nowrap;
}

.search-input {
  flex: 1;
  height: 28px;
  padding: 0 8px;
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: 4px;
  font-size: 12px;
  color: var(--ink);
  outline: none;
  -webkit-appearance: none;
}
.search-input::placeholder { color: var(--muted); }
.search-input:focus { border-color: var(--focus); }

.reset-btn {
  flex-shrink: 0;
  height: 28px;
  padding: 0 10px;
  background: none;
  border: 1px solid var(--rule);
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  cursor: pointer;
  white-space: nowrap;
}
.reset-btn:hover { border-color: var(--focus); color: var(--focus); }

/* ── Scroll container ───────────────────────────────────────── */
.scroll-container {
  background: var(--paper-raised);
}

/* ── Status ─────────────────────────────────────────────────── */
.status {
  padding: 32px 20px;
  text-align: center;
  font-size: 13px;
  color: var(--muted);
}
.error { color: var(--faded-red); }

/* ── Event row ──────────────────────────────────────────────── */
.event-row {
  display: flex;
  align-items: center;
  height: 56px;
  padding: 0 14px;
  gap: 10px;
  text-decoration: none;
  color: var(--ink);
  border-bottom: 1px solid var(--rule);
  box-sizing: border-box;
  transition: background 0.1s;
}
.event-row:hover { background: var(--paper); }

.event-thumb {
  width: 40px;
  height: 40px;
  object-fit: cover;
  border-radius: 3px;
  flex-shrink: 0;
}

.event-thumb-placeholder {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
}

.event-date {
  font-size: 11px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  flex-shrink: 0;
  width: 80px;
}

.event-title {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.event-tags {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  max-width: 160px;
  overflow: hidden;
}

.org-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.event-meta {
  font-size: 10px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
