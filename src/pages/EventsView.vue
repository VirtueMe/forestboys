<template>
  <div class="events-page">
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

    <!-- Timeline — always visible -->
    <div class="timeline-wrap">
      <div id="timeline-embed"></div>
    </div>

    <!-- Detail panel -->
    <div v-if="isDetail" class="panels">
      <div v-if="loadingDetail" class="status">Laster hendelse…</div>
      <div v-else-if="detailError" class="status error">Hendelsen ble ikke funnet.</div>
      <EventPanel v-else-if="visibleDetail" :event="visibleDetail" class="panel" />
    </div>

    <!-- Event list -->
    <template v-else>
      <div class="list-heading">
        <span class="list-label">Hendelser ({{ fmt(filteredEvents.length) }})</span>
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
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute, useRouter, RouterLink, onBeforeRouteUpdate } from 'vue-router'
import { useEventsContext } from '../composables/useEventsContext.ts'
import EventPanel from '../components/EventPanel.vue'
import CustomSelect from '../components/CustomSelect.vue'
import { Timeline } from '@knight-lab/timelinejs'
import '@knight-lab/timelinejs/dist/css/timeline.css'
import type { IdbEvent } from '../types/idb.ts'

const route  = useRoute()
const router = useRouter()

const {
  loading, init,
  isDetail,
  org, districts, setOrg, setDistricts, availableDistricts, allOrgs,
  districtColorMap, searchQuery, hasFilter, resetFilters,
  filteredEvents, visibleDetail, loadingDetail, detailError,
  orgColor, buildTimelineData,
} = useEventsContext()

// ── Timeline (DOM-level) ──────────────────────────────────────
let tlInstance: Timeline | null = null
let externalChange = false

function mountTimeline(evts: IdbEvent[]) {
  const el = document.getElementById('timeline-embed')
  if (!el) return
  el.innerHTML = ''
  tlInstance = null
  if (!evts.length) return

  const slugVal   = (route.params.slug as string | undefined) ?? ''
  const hashVal   = route.hash?.slice(1) ?? ''
  const startSlug = hashVal || slugVal
  const startAtSlide = Math.max(0, startSlug ? evts.findIndex(e => e.slug === startSlug) : 0)

  const timelineData = buildTimelineData(evts)

  const tl = new Timeline('timeline-embed', timelineData, {
    language:         'no',
    timenav_position: 'bottom',
    initial_zoom:     2,
    start_at_slide:   startAtSlide,
  })

  tlInstance = tl
  const slugSet = new Set(evts.map(e => e.slug))

  tl.on('ready', () => {
    let initFired = false
    tl.on('change', ({ unique_id }) => {
      if (!initFired) { initFired = true; return }   // skip post-ready init event
      if (externalChange) { externalChange = false; return }
      if (!unique_id || !slugSet.has(unique_id)) return
      const currentSlug = (route.params.slug as string | undefined) ?? ''
      if (unique_id === currentSlug) return
      void router.push({ path: `/events/${unique_id}`, query: route.query })
    })
  })
}

watch(() => route.hash, (hash) => {
  if (!tlInstance) return
  const slug   = hash?.slice(1) ?? ''
  const target = slug || ((route.params.slug as string | undefined) ?? '')
  if (!target) return
  externalChange = true
  tlInstance.goToId(target)
})

watch(filteredEvents, async (evts) => {
  mountTimeline(evts)
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
  background: var(--color-bg);
  max-width: 1320px;
  margin: 0 auto;
  width: 100%;
}

/* ── Filters (/events) ──────────────────────────────────────── */
.filters {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.search-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.filter-select {
  font-size: 13px;
  padding: 5px 10px;
  border: 1px solid var(--color-border-mid);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text);
  cursor: pointer;
  width: 100%;
}

/* ── Back link (inside filters, detail mode) ────────────────── */
.back-link {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-navy);
  text-decoration: none;
}
.back-link:hover { text-decoration: underline; }

/* ── Timeline ───────────────────────────────────────────────── */
.timeline-wrap {
  flex-shrink: 0;
  border-bottom: 1px solid var(--color-border);
  width: 100vw;
  margin-left: calc(-50vw + 50%);
}

#timeline-embed {
  width: 100%;
  height: 400px;
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
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.list-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--color-muted);
  white-space: nowrap;
}

.search-input {
  flex: 1;
  height: 28px;
  padding: 0 8px;
  background: var(--color-bg);
  border: 1px solid var(--color-border-mid);
  border-radius: 4px;
  font-size: 12px;
  color: var(--color-text);
  outline: none;
  -webkit-appearance: none;
}
.search-input::placeholder { color: var(--color-muted); }
.search-input:focus { border-color: var(--color-navy); }

.reset-btn {
  flex-shrink: 0;
  height: 28px;
  padding: 0 10px;
  background: none;
  border: 1px solid var(--color-border-mid);
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-muted);
  cursor: pointer;
  white-space: nowrap;
}
.reset-btn:hover { border-color: var(--color-navy); color: var(--color-navy); }

/* ── Scroll container ───────────────────────────────────────── */
.scroll-container {
  background: var(--color-surface);
}

/* ── Status ─────────────────────────────────────────────────── */
.status {
  padding: 32px 20px;
  text-align: center;
  font-size: 13px;
  color: var(--color-muted);
}
.error { color: var(--color-red); }

/* ── Event row ──────────────────────────────────────────────── */
.event-row {
  display: flex;
  align-items: center;
  height: 56px;
  padding: 0 14px;
  gap: 10px;
  text-decoration: none;
  color: var(--color-text);
  border-bottom: 1px solid var(--color-border);
  box-sizing: border-box;
  transition: background 0.1s;
}
.event-row:hover { background: var(--color-bg); }

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
  color: var(--color-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  flex-shrink: 0;
  width: 80px;
}

.event-title {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
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
  color: var(--color-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
