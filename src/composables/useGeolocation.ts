import { ref } from 'vue'
import { readUserPosition, saveUserPosition } from './useLocationCache.ts'

export interface GeoPosition {
  lat: number
  lng: number
}

const GEO_MAX_AGE_MS = 24 * 60 * 60 * 1000

export function useGeolocation() {
  const position = ref<GeoPosition | null>(null)
  const denied = ref(false)

  // Restore from IDB. Returns true if a fresh saved position was found.
  async function init(): Promise<boolean> {
    const saved = await readUserPosition()
    if (saved && Date.now() - saved.savedAt < GEO_MAX_AGE_MS) {
      position.value = { lat: saved.lat, lng: saved.lng }
      return true
    }
    return false
  }

  // Request fresh geolocation from the browser. Saves to IDB on success.
  function request() {
    if (!navigator.geolocation) {
      denied.value = true
      return
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        const geo: GeoPosition = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        position.value = geo
        void saveUserPosition({ ...geo, savedAt: Date.now() })
      },
      () => {
        denied.value = true
      },
      { enableHighAccuracy: false, timeout: 10_000 },
    )
  }

  return { position, denied, init, request }
}
