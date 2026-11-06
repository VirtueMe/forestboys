/**
 * GET /images/* — public R2 object streaming endpoint.
 *
 * /images/<id>[?w=N]  an image stored by the door (_lib/images.ts): the stored size that fits
 *                     w, else 900. No resizing here, so the answer is immutable.
 * /images/<key>       any other public key as it is: the one card image uploaded before #410 (`cards/...`, home card 4).
 *                     The card upload stores through the door now; replacing that image retires this branch.
 *
 * `masters/` and `_meta/` are never served.
 */
import { displayKey, isImageId, isPrivateKey, sizeCandidates } from '../_lib/images.ts'

interface Env {
  IMAGES: R2Bucket
}

export const onRequestGet: PagesFunction<Env> = async ({ params, env, request }) => {
  const raw = params.path
  const key = Array.isArray(raw) ? raw.join('/') : String(raw ?? '')
  if (!key || isPrivateKey(key)) return new Response('Not found', { status: 404 })

  let obj: R2ObjectBody | null = null
  if (isImageId(key)) {
    const w = new URL(request.url).searchParams.get('w')
    for (const size of sizeCandidates(w)) {
      obj = await env.IMAGES.get(displayKey(key, size))
      if (obj) break
    }
  } else {
    obj = await env.IMAGES.get(key)
  }
  if (!obj) return new Response('Not found', { status: 404 })

  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('etag', obj.httpEtag)
  headers.set('cache-control', 'public, max-age=31536000, immutable')

  return new Response(obj.body, { headers })
}
