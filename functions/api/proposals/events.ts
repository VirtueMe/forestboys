/**
 * GET /api/proposals/events?channel=<slug> — Server-Sent Events stream for
 * proposal-bundle changes on one channel: an outline id, or `sanity-<type>`
 * for sync bundles (functions/_lib/bundle-origin.ts). `outlineId=` still
 * works as the older name for the same parameter.
 *
 * The `BUNDLE_EVENTS` Durable Object lives in the separate worker `milorg-bundle-events` (workers/bundle-events), which
 * Pages only binds to (wrangler.toml, docs/CLOUDFLARE.md). Ingest broadcasts on this channel when a bundle arrives.
 */

interface Env {
  BUNDLE_EVENTS: DurableObjectNamespace
}

const SLUG_RE = /^[a-z0-9-]+$/

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url)
  const channel = url.searchParams.get('channel') ?? url.searchParams.get('outlineId') ?? ''
  if (!SLUG_RE.test(channel)) {
    return new Response(JSON.stringify({ error: 'channel required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }
  const id   = env.BUNDLE_EVENTS.idFromName(channel)
  const stub = env.BUNDLE_EVENTS.get(id)
  return await stub.fetch(new URL('/subscribe', request.url).toString(), { method: 'GET' })
}
