/**
 * milorg-bundle-events — sibling Worker hosting the BundleEventsDO
 * durable object. Pages can't host DO classes itself (per CF docs), so
 * this Worker is the home for the class. The Pages project binds to it
 * via `script_name = "milorg-bundle-events"`.
 *
 * The Worker also exposes a thin fetch handler so it can be invoked
 * directly during local dev (`wrangler dev` in this directory). In
 * production Pages calls the DO's stub directly via the binding, so
 * the default fetch handler isn't strictly required — kept here as a
 * health check.
 */

export class BundleEventsDO {
  private subscribers = new Set<ReadableStreamDefaultController<Uint8Array>>()
  private encoder     = new TextEncoder()

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'POST' && url.pathname === '/broadcast') {
      const text  = await request.text()
      const chunk = this.encoder.encode(`data: ${text}\n\n`)
      const dead: ReadableStreamDefaultController<Uint8Array>[] = []
      for (const c of this.subscribers) {
        try { c.enqueue(chunk) } catch { dead.push(c) }
      }
      for (const c of dead) this.subscribers.delete(c)
      return new Response(JSON.stringify({ ok: true, subscribers: this.subscribers.size }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (request.method === 'GET' && url.pathname === '/subscribe') {
      const subscribers = this.subscribers
      const encoder     = this.encoder
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          subscribers.add(controller)
          controller.enqueue(encoder.encode(': connected\n\n'))
        },
      })
      return new Response(stream, {
        headers: {
          'Content-Type':  'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection':    'keep-alive',
        },
      })
    }

    return new Response('Not found', { status: 404 })
  }
}

export default {
  fetch(): Response {
    return new Response('milorg-bundle-events Worker — Durable Object only, see /api/proposals/events', { status: 200 })
  },
}
