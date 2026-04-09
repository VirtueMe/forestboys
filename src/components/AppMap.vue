<template>
  <div ref="mapEl" class="map-container"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Feature, FeatureCollection, Point } from 'geojson'
import type { IdbLocation, IdbStation } from '../types/idb.ts'

export interface InitialView {
  lat: number
  lng: number
  zoom: number
}

const props = defineProps<{
  locations: IdbLocation[]
  stations: IdbStation[]
  userPosition?: { lat: number; lng: number } | null
  initialView?: InitialView | null
  showLocations?: boolean
  showStations?: boolean
}>()

export interface MapMovePayload {
  centre: { lat: number; lng: number }
  bounds: { north: number; south: number; east: number; west: number }
  zoom: number
}

const emit = defineEmits<{
  'select-location': [item: IdbLocation | IdbStation]
  'map-click': []
  'moveend': [payload: MapMovePayload]
}>()

const mapEl = ref<HTMLElement | null>(null)
let map: maplibregl.Map | null = null
let userMarker: maplibregl.Marker | null = null

const CARTO_STYLE = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json'

function buildGeoJSON(locations: IdbLocation[], stations: IdbStation[]): FeatureCollection {
  const locFeatures: Feature[] = locations.map(l => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [l.lng, l.lat] },
    properties: { id: l._id, type: 'location', title: l.title, color: l.color ?? 'navy' },
  }))
  const staFeatures: Feature[] = stations.map(s => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
    properties: { id: s._id, type: 'station', title: s.title, color: 'green' },
  }))
  return { type: 'FeatureCollection', features: [...locFeatures, ...staFeatures] }
}

function colorExpr() {
  return [
    'match', ['get', 'color'],
    'red',   '#8b1a1a',
    'green', '#2d6a4f',
    /* default navy */ '#1e3a5f',
  ]
}

onMounted(() => {
  if (!mapEl.value) return

  map = new maplibregl.Map({
    container: mapEl.value,
    style: CARTO_STYLE,
    center: props.initialView ? [props.initialView.lng, props.initialView.lat] : [15.0, 65.0],
    zoom: props.initialView?.zoom ?? 4,
    attributionControl: false,
  })

  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')

  map.on('load', () => {
    if (!map) return

    map.addSource('points', {
      type: 'geojson',
      data: buildGeoJSON(props.locations, props.stations),
      cluster: true,
      clusterMaxZoom: 12,
      clusterRadius: 40,
    })

    // Cluster circles
    map.addLayer({
      id: 'clusters',
      type: 'circle',
      source: 'points',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': '#1e3a5f',
        'circle-radius': ['step', ['get', 'point_count'], 16, 10, 22, 50, 28],
        'circle-opacity': 0.85,
      },
    })

    map.addLayer({
      id: 'cluster-count',
      type: 'symbol',
      source: 'points',
      filter: ['has', 'point_count'],
      layout: {
        'text-field': '{point_count_abbreviated}',
        'text-size': 12,
        'text-font': ['Noto Sans Bold'],
      },
      paint: { 'text-color': '#ffffff' },
    })

    // Individual points
    map.addLayer({
      id: 'unclustered',
      type: 'circle',
      source: 'points',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': colorExpr() as maplibregl.ExpressionSpecification,
        'circle-radius': 7,
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#fff',
        'circle-opacity': 0.9,
      },
    })

    // Cluster click → zoom in
    map.on('click', 'clusters', e => {
      if (!map || !e.features?.length) return
      const feature = e.features[0]
      const geometry = feature.geometry as Point
      map.easeTo({ center: geometry.coordinates as [number, number], zoom: map.getZoom() + 2 })
    })

    // Point click → select
    map.on('click', 'unclustered', e => {
      if (!e.features?.length) return
      const id = e.features[0].properties?.id as string
      const item =
        props.locations.find(l => l._id === id) ??
        props.stations.find(s => s._id === id)
      if (item) emit('select-location', item)
    })

    // Background click → clear
    map.on('click', e => {
      const features = map!.queryRenderedFeatures(e.point, { layers: ['unclustered', 'clusters'] })
      if (!features.length) emit('map-click')
    })

    map.on('mouseenter', 'unclustered', () => { if (map) map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'unclustered', () => { if (map) map.getCanvas().style.cursor = '' })
    map.on('mouseenter', 'clusters', () => { if (map) map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'clusters', () => { if (map) map.getCanvas().style.cursor = '' })

    // Emit bounds + centre after every camera movement (includes flyTo / fitBounds)
    const emitMoveEnd = () => {
      if (!map) return
      const c = map.getCenter()
      const b = map.getBounds()
      emit('moveend', {
        centre: { lat: c.lat, lng: c.lng },
        zoom: map.getZoom(),
        bounds: {
          north: b.getNorth(),
          south: b.getSouth(),
          east:  b.getEast(),
          west:  b.getWest(),
        },
      })
    }
    map.on('moveend', emitMoveEnd)

    // MapLibre fires the initial moveend before load — emit once now so the
    // sidebar always has bounds, even when opening from a saved map state.
    emitMoveEnd()
  })
})

// Update source when data or visibility changes
watch([() => props.locations, () => props.stations, () => props.showLocations, () => props.showStations], () => {
  if (!map?.isStyleLoaded()) return
  const src = map.getSource('points')
  if (src?.type === 'geojson') {
    const locs = props.showLocations !== false ? props.locations : []
    const stas = props.showStations !== false ? props.stations : []
    ;(src as maplibregl.GeoJSONSource).setData(buildGeoJSON(locs, stas))
  }
})

// User position marker
watch(() => props.userPosition, pos => {
  if (!map || !pos) return
  if (userMarker) {
    userMarker.setLngLat([pos.lng, pos.lat])
  } else {
    const el = document.createElement('div')
    el.className = 'user-dot'
    userMarker = new maplibregl.Marker({ element: el })
      .setLngLat([pos.lng, pos.lat])
      .addTo(map)
  }
})

onBeforeUnmount(() => {
  map?.remove()
})

// Expose fitBounds for parent
function fitLocations() {
  if (!map || (!props.locations.length && !props.stations.length)) return
  const all = [
    ...props.locations.map(l => [l.lng, l.lat] as [number, number]),
    ...props.stations.map(s => [s.lng, s.lat] as [number, number]),
  ]
  const lngs = all.map(c => c[0])
  const lats = all.map(c => c[1])
  map.fitBounds(
    [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
    { padding: { top: 40, bottom: 40, left: 380, right: 40 } },
  )
}

function flyTo(lng: number, lat: number, zoom = 14) {
  map?.flyTo({ center: [lng, lat], zoom })
}

function restoreBounds(bounds: { north: number; south: number; east: number; west: number }) {
  if (!map) return
  map.fitBounds(
    [[bounds.west, bounds.south], [bounds.east, bounds.north]],
    { padding: { top: 40, bottom: 40, left: 380, right: 40 }, animate: true },
  )
}

defineExpose({ fitLocations, flyTo, restoreBounds })
</script>

<style scoped>
.map-container {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: var(--drawer-height);
}

@media (min-width: 768px) {
  .map-container {
    left: var(--sidebar-width);
    bottom: 0;
  }
}
</style>

<style>
.user-dot {
  width: 14px;
  height: 14px;
  background: var(--color-you);
  border: 2px solid #fff;
  border-radius: 50%;
  box-shadow: 0 0 0 3px rgba(26,115,232,0.3);
}
</style>
