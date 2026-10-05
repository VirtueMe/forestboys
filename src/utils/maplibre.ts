/**
 * MapLibre with its worker wired up for Vite.
 *
 * maplibre-gl 6 finds its worker with `new URL('./maplibre-gl-worker.mjs',
 * import.meta.url)`. Once Vite folds the library into the entry chunk that
 * path points at a file that does not exist, the app's SPA fallback answers
 * with index.html, and the map renders nothing ("Worker failed to load").
 * `?worker&url` emits the worker as one standalone file (its import of
 * maplibre-gl-shared.mjs bundled in), and setWorkerUrl hands it over.
 */
import * as maplibregl from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

maplibregl.setWorkerUrl(workerUrl)

export { maplibregl }
