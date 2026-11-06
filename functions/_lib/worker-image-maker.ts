/**
 * The Pages functions' `ImageMaker` for `storeImage` (#410, epic #405). A Worker cannot run sharp or cjxl, and the
 * Pages project cannot have the Cloudflare Images binding, so the display files are made by the `milorg-image-maker`
 * worker (image-maker-handler.ts) through the service binding `IMAGE_MAKER`. Two transformations per upload at most,
 * one per stored size; the master is the upload itself (decision in #408).
 *
 * Structural, so a test can pass the handler itself as the service.
 */
import type { ImageMaker } from './store-image.ts'

/** The part of a service binding (`Fetcher`) the maker uses. */
export interface MakerService {
  fetch(url: string, init: { method: 'POST', body: Uint8Array }): Promise<Response>
}

// The host is a placeholder: a service binding ignores it.
const BASE = 'https://image-maker'

async function failure(what: string, res: Response): Promise<Error> {
  const body = await res.text().catch(() => '')
  let reason = body
  try { reason = (JSON.parse(body) as { error?: string }).error ?? body } catch { /* not JSON: keep the text */ }
  return new Error(`image maker ${what} answered ${res.status}: ${reason.slice(0, 200)}`)
}

export function remoteImageMaker(service: MakerService): ImageMaker {
  return {
    async dimensions(bytes) {
      const res = await service.fetch(`${BASE}/info`, { method: 'POST', body: bytes })
      if (!res.ok) throw await failure('info', res)
      const { width, height } = await res.json<{ width: number, height: number }>()
      return { width, height }
    },
    async resize(bytes, widths) {
      const out = []
      for (const size of widths) {
        const res = await service.fetch(`${BASE}/resize?width=${size}`, { method: 'POST', body: bytes })
        if (!res.ok) throw await failure(`resize ${size}`, res)
        out.push({ size, bytes: new Uint8Array(await res.arrayBuffer()) })
      }
      return out
    },
  }
}
