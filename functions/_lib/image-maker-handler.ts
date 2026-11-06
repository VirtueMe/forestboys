/**
 * The request handler of the `milorg-image-maker` worker (#410, epic #405): the one place that holds the Cloudflare Images
 * binding. Pages cannot have that binding (its `wrangler.toml` refuses `[images]`), so the Pages functions call this worker
 * through a service binding (`IMAGE_MAKER`) and `remoteImageMaker` (`worker-image-maker.ts`) is their `ImageMaker`.
 *
 *   POST /info                the image bytes in, `{ format, width, height }` out
 *   POST /resize?width=<px>   the image bytes in, a WebP of that width out (never enlarged)
 *
 * Here and not in `workers/image-maker/src` so it is type-checked and tested like the rest of `functions/`; the worker's
 * entry is only `export default { fetch: ... }`. The worker has no public address (`workers_dev = false`): only a service
 * binding reaches it, so it takes no login.
 */

/** The part of the Images binding (`ImagesBinding`) the handler uses. */
export interface ImagesApi {
  info(stream: ReadableStream<Uint8Array>): Promise<{ format: string, width?: number, height?: number }>
  input(stream: ReadableStream<Uint8Array>): {
    transform(t: { width: number, fit: 'scale-down' }): {
      output(o: { format: 'image/webp' }): Promise<{ image(): ReadableStream<Uint8Array> }>
    }
  }
}

export const MAX_WIDTH = 4000

const json = (data: unknown, status: number) => Response.json(data, { status })

export async function handleImageMaker(request: Request, images: ImagesApi): Promise<Response> {
  const url = new URL(request.url)
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405)
  if (url.pathname !== '/info' && url.pathname !== '/resize') return json({ error: 'Not found' }, 404)

  // A fresh stream per use: the binding consumes the one it is given.
  const bytes = new Uint8Array(await request.arrayBuffer())
  if (!bytes.length) return json({ error: 'Empty body' }, 400)
  const stream = () => new Blob([bytes]).stream() as ReadableStream<Uint8Array>

  try {
    if (url.pathname === '/info') {
      const info = await images.info(stream())
      if (!info.width || !info.height) return json({ error: `No size for ${info.format}` }, 422)
      return json({ format: info.format, width: info.width, height: info.height }, 200)
    }

    const width = Number(url.searchParams.get('width'))
    if (!Number.isInteger(width) || width < 1 || width > MAX_WIDTH) return json({ error: `width must be 1-${MAX_WIDTH}` }, 400)
    const out = await images.input(stream()).transform({ width, fit: 'scale-down' }).output({ format: 'image/webp' })
    return new Response(out.image(), { headers: { 'Content-Type': 'image/webp' } })
  } catch (e) {
    return json({ error: (e as Error).message }, 422)
  }
}
