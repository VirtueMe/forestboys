/**
 * GET /api/proposals/events?outlineId=<slug> — Server-Sent Events stream
 * for proposal-bundle changes scoped to one outline.
 *
 * The DO class itself lives in `functions/_middleware.ts` so Pages'
 * bundler keeps it in the entrypoint.
 */

interface Env {
  BUNDLE_EVENTS: DurableObjectNamespace
}

const SLUG_RE = /^[a-z0-9-]+$/

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url)
  const outlineId = url.searchParams.get('outlineId') ?? ''
  if (!SLUG_RE.test(outlineId)) {
    return new Response(JSON.stringify({ error: 'outlineId required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }
  const id   = env.BUNDLE_EVENTS.idFromName(outlineId)
  const stub = env.BUNDLE_EVENTS.get(id)
  return await stub.fetch(new URL('/subscribe', request.url).toString(), { method: 'GET' })
}
