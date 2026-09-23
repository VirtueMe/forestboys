<template>
  <div class="location-map">
    <div ref="mapEl" class="map-canvas" :class="{ 'map-canvas--readonly': readonly }"></div>
    <p v-if="!readonly" class="map-hint">Klikk i kartet eller dra markøren for å sette koordinater.</p>
  </div>
</template>

<script setup lang="ts">
/**
 * LocationMap — small MapLibre map with a single Location marker.
 *
 * Edit mode (default): coordinate picker. Click anywhere to move the
 * marker there; the marker is draggable. Emits `pick` with coordinates
 * rounded to 6 decimals (~10 cm), which the scalar editor writes back
 * into its lat/lng text fields.
 *
 * Readonly: preview map. The marker is fixed and, when `markerTo` is
 * set, acts as a link (click / Enter) — same target as "Vis i kart".
 * Scroll-zoom is off so the map doesn't hijack page scrolling.
 *
 * The map follows prop changes (typed coordinates, Angre) without
 * re-centring on every keystroke — it only flies when the marker
 * would otherwise be off-screen.
 */
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

const props = defineProps<{
  lat:       number | null
  lng:       number | null
  readonly?: boolean
  /** Readonly only: route the marker navigates to. */
  markerTo?: string
}>()

const emit = defineEmits<{
  pick: [lat: number, lng: number]
}>()

const router = useRouter()

const CARTO_STYLE = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json'
// Norway overview when the location has no coordinates yet.
const DEFAULT_CENTER: [number, number] = [10.75, 63.0]
const DEFAULT_ZOOM   = 3.6
const PLACED_ZOOM    = 10

const mapEl = ref<HTMLDivElement | null>(null)
let map:    maplibregl.Map | null = null
let marker: maplibregl.Marker | null = null
// The edit pane mounts hidden (v-show), so the map starts at 0×0 —
// resize whenever the container actually gets a size.
let ro:     ResizeObserver | null = null

function round6(n: number): number { return Math.round(n * 1e6) / 1e6 }

function makeMarkerLink(el: HTMLElement, to: string) {
  el.classList.add('marker-link')
  el.setAttribute('role', 'link')
  el.setAttribute('tabindex', '0')
  el.setAttribute('aria-label', 'Vis i kart')
  el.title = 'Vis i kart'
  const go = () => { void router.push(to) }
  el.addEventListener('click', (e) => { e.stopPropagation(); go() })
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') go() })
}

function placeMarker(lng: number, lat: number) {
  if (!map) return
  if (!marker) {
    // Marker takes a literal colour — resolve the accent token at runtime.
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--faded-red').trim()
    marker = new maplibregl.Marker({ color: accent || undefined, draggable: !props.readonly })
      .setLngLat([lng, lat])
      .addTo(map)
    if (props.readonly) {
      if (props.markerTo) makeMarkerLink(marker.getElement(), props.markerTo)
    } else {
      marker.on('dragend', () => {
        const p = marker!.getLngLat()
        emit('pick', round6(p.lat), round6(p.lng))
      })
    }
  } else {
    marker.setLngLat([lng, lat])
  }
}

onMounted(() => {
  if (!mapEl.value) return
  const has = props.lat != null && props.lng != null
  map = new maplibregl.Map({
    container:  mapEl.value,
    style:      CARTO_STYLE,
    center:     has ? [props.lng, props.lat] : DEFAULT_CENTER,
    zoom:       has ? PLACED_ZOOM : DEFAULT_ZOOM,
    scrollZoom: !props.readonly,
    attributionControl: false,
  })
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
  if (has) placeMarker(props.lng, props.lat)

  ro = new ResizeObserver(() => map?.resize())
  ro.observe(mapEl.value)

  if (!props.readonly) {
    map.on('click', (e) => {
      placeMarker(e.lngLat.lng, e.lngLat.lat)
      emit('pick', round6(e.lngLat.lat), round6(e.lngLat.lng))
    })
  }
})

watch(() => [props.lat, props.lng] as const, ([lat, lng]) => {
  if (!map) return
  if (lat == null || lng == null) {
    marker?.remove()
    marker = null
    return
  }
  placeMarker(lng, lat)
  if (!map.getBounds().contains([lng, lat])) {
    map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), PLACED_ZOOM) })
  }
})

onBeforeUnmount(() => {
  ro?.disconnect()
  marker?.remove()
  map?.remove()
  marker = null
  map    = null
  ro     = null
})
</script>

<style scoped>
.location-map { display: flex; flex-direction: column; gap: var(--space-xs); }
.map-canvas {
  width: 100%;
  height: 260px;
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  overflow: hidden;
}
.map-canvas--readonly { height: 200px; }
.map-hint {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--muted);
}
/* Marker element is created by MapLibre outside the scoped tree. */
.map-canvas :deep(.marker-link) { cursor: pointer; }
.map-canvas :deep(.marker-link:focus-visible) { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 50%; }
</style>
