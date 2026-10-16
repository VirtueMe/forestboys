<template>
  <div class="location-map" :class="{ 'location-map--readonly': readonly, 'location-map--cinema': cinema }">
    <div ref="mapEl" class="map-canvas" :class="{ 'map-canvas--readonly': readonly }"></div>
    <p v-if="!readonly" class="map-hint">Klikk i kartet eller dra markøren for å sette koordinater.</p>
  </div>
</template>

<script setup lang="ts">
/**
 * LocationMap — small MapLibre map with a single marker for a Location or a
 * Station (the station editor and page use it too).
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
 *
 * Readonly, it starts as wide as the text beside it, with two buttons like a video player's (#288): «Kinomodus»
 * widens it to the page at the same 16:9, «Fullskjerm» fills the screen (scroll-zoom on while it does). Both keep the
 * same area in view, shown bigger: the zoom follows the change in size, as a video is scaled rather than cropped.
 * Cinema mode is not offered on a phone, where the map is full width already.
 */
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import { maplibregl } from '@/utils/maplibre'
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

const mapEl  = ref<HTMLDivElement | null>(null)
const cinema = ref(false)
let map:    maplibregl.Map | null = null
let marker: maplibregl.Marker | null = null
// The edit pane mounts hidden (v-show), so the map starts at 0×0 —
// resize whenever the container actually gets a size.
let ro:     ResizeObserver | null = null
// Set by the cinema and full-screen buttons: the next resize keeps the area in view instead of showing more of it.
let keepView = false
let lastSize: { w: number; h: number } | null = null

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

/** «Kinomodus» as a map control, so it sits with the zoom buttons and looks like them. */
class CinemaControl implements maplibregl.IControl {
  private container: HTMLDivElement | null = null
  onAdd(): HTMLElement {
    const container = document.createElement('div')
    container.className = 'maplibregl-ctrl maplibregl-ctrl-group cinema-ctrl'
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'cinema-btn'
    button.innerHTML = '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><rect x="2" y="5.5" width="16" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>'
    const label = () => {
      const text = cinema.value ? 'Vanlig bredde' : 'Kinomodus'
      button.title = text
      button.setAttribute('aria-label', text)
      button.setAttribute('aria-pressed', String(cinema.value))
    }
    label()
    button.addEventListener('click', () => { keepView = true; cinema.value = !cinema.value; label() })
    container.appendChild(button)
    this.container = container
    return container
  }
  onRemove(): void { this.container?.remove(); this.container = null }
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
    locale: {
      'FullscreenControl.Enter': 'Fullskjerm',
      'FullscreenControl.Exit':  'Avslutt fullskjerm',
      'NavigationControl.ZoomIn':  'Zoom inn',
      'NavigationControl.ZoomOut': 'Zoom ut',
    },
  })
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
  if (props.readonly) {
    map.addControl(new CinemaControl(), 'top-right')
    const fullscreen = new maplibregl.FullscreenControl()
    // Full screen is for looking around: let the wheel zoom there, not on the page.
    fullscreen.on('fullscreenstart', () => { keepView = true; map?.scrollZoom.enable() })
    fullscreen.on('fullscreenend',   () => { keepView = true; map?.scrollZoom.disable() })
    // Each doubling of the map's size is one zoom level: zoom by the change, so the same area fills the bigger map. The
    // scale is that of the area (√(width × height)), so going in and coming back out cancel exactly even when full
    // screen has another shape than the map.
    map.on('resize', () => {
      const el = map!.getContainer()
      const size = { w: el.clientWidth, h: el.clientHeight }
      if (keepView && lastSize?.w && lastSize.h && size.w && size.h) {
        const scale = Math.sqrt((size.w / lastSize.w) * (size.h / lastSize.h))
        map!.easeTo({ zoom: map!.getZoom() + Math.log2(scale), duration: 250 })
      }
      keepView = false
      if (size.w && size.h) lastSize = size
    })
    map.addControl(fullscreen, 'top-right')
  }
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
/* Readonly: 16:9 like a video, so it grows with its width (#288). */
.map-canvas--readonly { height: auto; aspect-ratio: 16 / 9; }
/* As wide as the text beside it; cinema mode widens it to the page and doubles its height (#288). `ch` is the width of a
   character in the element's own font, so the map takes the description's font (.portable-text) to come out the same
   width; MapLibre's controls set a font of their own. */
.location-map--readonly {
  max-width: var(--prose-max-width);
  font-family: var(--font-serif);
  font-size: var(--size-body);
}
.location-map--cinema { max-width: none; }
/* Cinema mode keeps 16:9 at the page's width, about twice the normal height, but never taller than the window can show. */
.location-map--cinema .map-canvas--readonly { max-height: 80vh; }
/* MapLibre's control buttons are white in both themes, so the icon takes MapLibre's own icon colour and, when on, the
   light theme's --faded-red: a theme token would turn pale on the white button in dark mode. */
.map-canvas :deep(.cinema-btn) { display: flex; align-items: center; justify-content: center; color: #333; }
.map-canvas :deep(.cinema-btn[aria-pressed="true"]) { color: #8b2e1f; }
.map-canvas :deep(.maplibregl-ctrl button:focus-visible) { outline: 2px solid var(--focus); outline-offset: 1px; }
@media (max-width: 520px) {
  .map-canvas :deep(.cinema-ctrl) { display: none; }
}
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
