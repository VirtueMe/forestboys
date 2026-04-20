/**
 * GET /images/* — public R2 object streaming endpoint.
 * Path after /images/ is used as the R2 key.
 */

interface Env {
  IMAGES: R2Bucket
}

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const raw = params.path
  const key = Array.isArray(raw) ? raw.join('/') : String(raw)
  if (!key) return new Response('Not found', { status: 404 })

  const obj = await env.IMAGES.get(key)
  if (!obj) return new Response('Not found', { status: 404 })

  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('etag', obj.httpEtag)
  headers.set('cache-control', 'public, max-age=31536000, immutable')

  return new Response(obj.body, { headers })
}
