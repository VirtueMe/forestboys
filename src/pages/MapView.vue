<template>
  <div class="app">
    <AppMap
      v-if="appReady"
      ref="mapRef"
      :locations="filteredLocations"
      :stations="filteredStations"
      :show-locations="showLocations"
      :show-stations="showStations"
      :user-position="position ?? undefined"
      :initial-view="initialView ?? undefined"
      @select-location="selectItem"
      @map-click="goBack"
      @moveend="onMoveEnd"
    />

    <FilterPanel
      :open="filterOpen"
      :orgs="allOrgs"
      :districts="allDistricts"
      :org-colors="orgColors"
      :district-colors="districtColors"
      :active-orgs="activeOrgs"
      :active-districts="activeDistricts"
      :search-text="searchText"
      :search-in-locations="searchInLocations"
      :search-in-stations="searchInStations"
      :search-in-events="searchInEvents"
      :search-in-people="searchInPeople"
      :show-locations="showLocations"
      :show-stations="showStations"
      :no-results="filterNoResults"
      @close="filterOpen = false; filterNoResults = false"
      @reset="resetFilters"
      @search="onSearch"
      @update:active-orgs="activeOrgs = $event"
      @update:active-districts="activeDistricts = $event"
      @update:search-text="searchText = $event"
      @update:search-in-locations="searchInLocations = $event"
      @update:search-in-stations="searchInStations = $event"
      @update:search-in-events="searchInEvents = $event"
      @update:search-in-people="searchInPeople = $event"
      @update:show-locations="showLocations = $event"
      @update:show-stations="showStations = $event"
    />

    <AppDrawer
      ref="drawerRef"
      :title="drawerTitle"
      :page-count="pageCount"
      :title-count="drawerCount"
      :on-back="selected ? goBack : undefined"
      :on-overview="showOverview"
      :on-nearest="showNearest"
      :on-filter="() => filterOpen = true"
      :filter-active="filterActive"
      :search-label="searchText.trim() || undefined"
      :on-clear-search="searchText.trim() ? clearSearch : undefined"
    >
      <template #default="{ page }">
        <template v-if="selected">
          <DetailView
            :item="selected"
            @back="goBack"
            @select-event="(ev) => router.push('/events/' + ev.slug)"
          />
        </template>
        <template v-else-if="loading">
          <div class="status">Laster data…</div>
        </template>
        <template v-else-if="visibleItems.length === 0">
          <div class="status">Ingen steder i dette området.</div>
        </template>
        <template v-else>
          <ItemCard
            v-for="item in itemsOnPage(page)"
            :key="item._id"
            :title="itemTitle(item)"
            :subtitle="itemSubtitle(item)"
            :tags="itemTags(item)"
            :thumb="itemThumb(item)"
            :accent-color="itemAccent(item)"
            @select="selectItem(item)"
          />
        </template>
      </template>
    </AppDrawer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import AppMap from '../components/AppMap.vue'
import AppDrawer from '../components/AppDrawer.vue'
import FilterPanel from '../components/FilterPanel.vue'
import ItemCard from '../components/ItemCard.vue'
import DetailView from '../components/DetailView.vue'
import type { MapMovePayload, InitialView } from '../components/AppMap.vue'
import { useLocationCache, readMapState, saveMapState } from '../composables/useLocationCache.ts'
import { useGeolocation } from '../composables/useGeolocation.ts'
import { haversineKm } from '../composables/useHaversine.ts'
import type { IdbLocation, IdbStation, IdbPerson } from '../types/idb.ts'

function itemThumb(item: MapItem | IdbPerson): string | undefined {
  return item.thumbnailUrl
}

type MapItem = IdbLocation | IdbStation

const router = useRouter()
const route = useRoute()
const { locations, stations, people, orgColors, districtColors, loading, init } = useLocationCache()
const { position, denied, init: geoInit, request: geoRequest } = useGeolocation()
const mapRef = ref<InstanceType<typeof AppMap> | null>(null)
const drawerRef = ref<InstanceType<typeof AppDrawer> | null>(null)
const selected = ref<MapItem | IdbPerson | null>(null)

// Map is hidden until we've loaded persisted state (avoids flash of wrong position)
const appReady = ref(false)
const initialView = ref<InitialView | null>(null)

// Track whether the initial map centre has been applied
const centred = ref(false)

// Filter state
const filterOpen = ref(false)
const filterNoResults = ref(false)
const activeOrgs = ref<string[]>([])
const activeDistricts = ref<string[]>([])
const searchText = ref('')
const searchInLocations = ref(true)
const searchInStations = ref(true)
const searchInEvents = ref(true)
const searchInPeople = ref(true)
const showLocations = ref(true)
const showStations = ref(true)

const allOrgs = computed(() => {
  const set = new Set<string>()
  for (const loc of locations.value) for (const o of loc.organizations ?? []) set.add(o)
  return [...set].sort()
})

const allDistricts = computed(() => {
  const set = new Set<string>()
  for (const loc of locations.value) for (const d of loc.districts ?? []) set.add(d)
  return [...set].sort()
})

const filterActive = computed(() =>
  activeOrgs.value.length > 0 || activeDistricts.value.length > 0 || searchText.value.trim() !== '' ||
  !showLocations.value || !showStations.value,
)

// Filtered data — applied to both map and sidebar
// Stations have no org/district fields so they pass through those filters
const filteredLocations = computed(() => {
  let result = locations.value
  if (activeOrgs.value.length > 0)
    result = result.filter(l => l.organizations?.some(o => activeOrgs.value.includes(o)))
  if (activeDistricts.value.length > 0)
    result = result.filter(l => l.districts?.some(d => activeDistricts.value.includes(d)))
  const q = searchText.value.toLowerCase().trim()
  if (q) {
    result = result.filter(l =>
      (searchInLocations.value && l.title.toLowerCase().includes(q)) ||
      (searchInEvents.value && l.events?.some(e => e.title.toLowerCase().includes(q))),
    )
  }
  return result
})

const filteredStations = computed(() => {
  const q = searchText.value.toLowerCase().trim()
  if (!q) return stations.value
  return stations.value.filter(s =>
    (searchInStations.value && s.title.toLowerCase().includes(q)) ||
    (searchInEvents.value && s.events?.some(e => e.title.toLowerCase().includes(q))),
  )
})

const filteredPeople = computed(() => {
  const q = searchText.value.toLowerCase().trim()
  if (!q || !searchInPeople.value) return []
  return people.value.filter(p => p.name.toLowerCase().includes(q))
})

// Sidebar state driven by map bounds
const lastMove = ref<MapMovePayload | null>(null)
const savedMove = ref<MapMovePayload | null>(null)

// Cards per page based on available drawer/sidebar height
const CARD_HEIGHT = 72
const CARD_GAP = 6
const HANDLE_ROW_H = 44

const cardsPerPage = computed(() => {
  const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 768
  const drawerH = isDesktop ? (typeof window !== 'undefined' ? window.innerHeight : 900) : 420
  const available = drawerH - HANDLE_ROW_H - 10
  return Math.max(1, Math.floor(available / (CARD_HEIGHT + CARD_GAP)))
})

const pageCount = computed(() => {
  if (selected.value) return 1
  return Math.ceil(visibleItems.value.length / cardsPerPage.value) || 1
})

const drawerTitle = computed(() => {
  if (selected.value) return 'name' in selected.value ? selected.value.name : selected.value.title
  if (loading.value) return 'Laster…'
  return 'Steder i kartet'
})

const drawerCount = computed(() => {
  if (selected.value || loading.value) return undefined
  return visibleItems.value.length
})

const visibleItems = computed<(MapItem | IdbPerson)[]>(() => {
  if (!lastMove.value) return []
  const { centre, bounds } = lastMove.value
  const q = searchText.value.trim()

  // Geo items — always bounds-filtered, unless text search bypasses bounds
  const geoItems: MapItem[] = [...filteredLocations.value, ...filteredStations.value]
  const bounded = q
    ? geoItems  // when searching, show all matches across Norway
    : geoItems.filter(l =>
        l.lat >= bounds.south && l.lat <= bounds.north &&
        l.lng >= bounds.west  && l.lng <= bounds.east,
      )
  const sorted = bounded.sort((a, b) =>
    haversineKm(centre.lat, centre.lng, a.lat, a.lng) -
    haversineKm(centre.lat, centre.lng, b.lat, b.lng),
  )

  return [...sorted, ...filteredPeople.value]
})

function buildQuery(overrideLat?: number, overrideLng?: number, overrideZ?: number) {
  const centre = lastMove.value?.centre
  const zoom = lastMove.value?.zoom
  const q: Record<string, string> = {}
  const lat = overrideLat ?? centre?.lat
  const lng = overrideLng ?? centre?.lng
  const z   = overrideZ   ?? zoom
  if (lat !== undefined) q.lat = lat.toFixed(5)
  if (lng !== undefined) q.lng = lng.toFixed(5)
  if (z   !== undefined) q.z   = z.toFixed(1)
  if (activeOrgs.value.length > 0)      q.orgs  = activeOrgs.value.join(',')
  if (activeDistricts.value.length > 0) q.dists = activeDistricts.value.join(',')
  if (searchText.value.trim()) {
    q.q  = searchText.value
    q.si = [
      searchInLocations.value && 'l',
      searchInStations.value  && 's',
      searchInEvents.value    && 'e',
      searchInPeople.value    && 'p',
    ].filter(Boolean).join(',')
  }
  return q
}

function replaceQuery() {
  void router.replace({ path: route.fullPath.split('?')[0], query: buildQuery() })
}

function onMoveEnd(move: MapMovePayload) {
  lastMove.value = move
  drawerRef.value?.resetPage()
  void saveMapState({ lat: move.centre.lat, lng: move.centre.lng, zoom: move.zoom, savedAt: Date.now() })
  void router.replace({
    path: route.fullPath.split('?')[0],
    query: buildQuery(move.centre.lat, move.centre.lng, move.zoom),
  })
}

// Reset page when filters change or data arrives
watch([activeOrgs, activeDistricts, searchText], () => drawerRef.value?.resetPage())
watch([locations, stations], () => { if (lastMove.value) drawerRef.value?.resetPage() })

// Encode chip state in URL whenever it changes
watch([activeOrgs, activeDistricts], replaceQuery)

function itemsOnPage(page: number): (MapItem | IdbPerson)[] {
  const cpp = cardsPerPage.value
  return visibleItems.value.slice(page * cpp, page * cpp + cpp)
}

function itemTitle(item: MapItem | IdbPerson): string {
  return 'name' in item ? item.name : item.title
}

function itemSubtitle(item: MapItem | IdbPerson): string {
  if ('districts' in item && item.districts?.length) return item.districts[0]
  if ('type' in item && item.type) return item.type
  if ('birthYear' in item && item.birthYear) return String(item.birthYear)
  return ''
}

function itemTags(item: MapItem | IdbPerson): string[] {
  if ('organizations' in item) return item.organizations?.slice(0, 2) ?? []
  return []
}

function itemAccent(item: MapItem | IdbPerson): string {
  if ('color' in item && item.color === 'red') return 'var(--color-red)'
  if ('color' in item && item.color === 'green') return 'var(--color-green)'
  return 'var(--color-navy)'
}

function selectItem(item: MapItem | IdbPerson) {
  savedMove.value = lastMove.value
  selected.value = item
  if ('lat' in item && 'lng' in item) {
    mapRef.value?.flyTo(item.lng, item.lat)
  }
  const prefix = 'lat' in item ? 'map' : 'person'
  void router.push({ path: `/${prefix}/${item.slug}`, query: route.query })
}

function trySelectFromSlug() {
  const slug = route.params.slug as string | undefined
  if (!slug || selected.value?.slug === slug) return
  const found = [...locations.value, ...stations.value].find(item => item.slug === slug)
  if (found) {
    selected.value = found
    savedMove.value = lastMove.value
    if ('lat' in found) mapRef.value?.flyTo(found.lng, found.lat)
  }
}

async function onSearch() {
  await nextTick()
  if (visibleItems.value.length > 0) {
    filterOpen.value = false
    filterNoResults.value = false
    replaceQuery()
  } else {
    filterNoResults.value = true
  }
}

function clearSearch() {
  searchText.value = ''
  filterNoResults.value = false
  replaceQuery()
}

function resetFilters() {
  filterNoResults.value = false
  activeOrgs.value = []
  activeDistricts.value = []
  searchText.value = ''
  searchInLocations.value = true
  searchInStations.value = true
  searchInEvents.value = true
  searchInPeople.value = true
  showLocations.value = true
  showStations.value = true
  replaceQuery()
}

watch(() => route.params.slug, trySelectFromSlug)
watch([locations, stations], trySelectFromSlug)

function goBack() {
  selected.value = null
  if (savedMove.value) {
    mapRef.value?.restoreBounds(savedMove.value.bounds)
  }
  if (route.params.slug) void router.push({ path: '/map', query: route.query })
}

function showOverview() {
  selected.value = null
  mapRef.value?.fitLocations()
}

function showNearest() {
  selected.value = null
  if (position.value) {
    mapRef.value?.flyTo(position.value.lng, position.value.lat, 12)
  } else {
    geoRequest()
    const stop = watch(position, pos => {
      if (!pos) return
      mapRef.value?.flyTo(pos.lng, pos.lat, 12)
      stop()
    })
  }
}

// When fresh geolocation arrives (only matters if centred is still false)
watch(position, pos => {
  if (!pos || centred.value) return
  centred.value = true
  mapRef.value?.flyTo(pos.lng, pos.lat, 12)
})

// When geolocation is denied with no prior centre
watch(denied, isDenied => {
  if (!isDenied || centred.value) return
  centred.value = true
  mapRef.value?.fitLocations()
})

onMounted(async () => {
  // ── Priority chain ─────────────────────────────────────────────────────
  // Run IDB reads in parallel (fast — local storage)
  const [savedMap, geoRestored] = await Promise.all([
    readMapState(),
    geoInit(),        // sets position.value if a fresh saved position exists
  ])

  // Restore filter + search state from URL
  const qOrgs  = route.query.orgs  as string | undefined
  const qDists = route.query.dists as string | undefined
  if (qOrgs)  activeOrgs.value      = qOrgs.split(',').filter(Boolean)
  if (qDists) activeDistricts.value = qDists.split(',').filter(Boolean)
  const qText = route.query.q as string | undefined
  if (qText) {
    searchText.value = qText
    const si = (route.query.si as string | undefined) ?? 'l,s,e,p'
    searchInLocations.value = si.includes('l')
    searchInStations.value  = si.includes('s')
    searchInEvents.value    = si.includes('e')
    searchInPeople.value    = si.includes('p')
  }

  const qLat = parseFloat(route.query.lat as string)
  const qLng = parseFloat(route.query.lng as string)
  const qZ   = parseFloat(route.query.z as string)
  if (!isNaN(qLat) && !isNaN(qLng) && !isNaN(qZ)) {
    // 0. Shared link — query params take priority over everything
    initialView.value = { lat: qLat, lng: qLng, zoom: qZ }
    centred.value = true
  } else if (savedMap) {
    // 1. Restore exact map position from last session
    initialView.value = { lat: savedMap.lat, lng: savedMap.lng, zoom: savedMap.zoom }
    centred.value = true
  } else if (position.value) {
    // 2. Centre on saved GPS position (no prior map state)
    initialView.value = { lat: position.value.lat, lng: position.value.lng, zoom: 12 }
    centred.value = true
  }
  // If neither, map opens at the Vite default (Norway z4) and fitBounds fires below

  appReady.value = true   // ← map renders now, with the correct initialView

  // Load location data (may trigger background sync)
  await init()

  if (geoRestored) {
    // 3a. Had a saved position — silently refresh it in the background
    geoRequest()
  } else if (!centred.value) {
    // 3b. No saved state at all — prompt for fresh geolocation
    geoRequest()
    // 4. Fallback: if geo is still pending after 5 s, fit the full dataset
    setTimeout(() => {
      if (!centred.value) {
        centred.value = true
        mapRef.value?.fitLocations()
      }
    }, 5000)
  }
})
</script>

<style scoped>
.app {
  width: 100%;
  flex: 1;
  min-height: 0;
  position: relative;
}
.status {
  padding: 20px;
  color: var(--color-muted);
  font-size: 13px;
}
</style>
