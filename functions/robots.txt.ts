/**
 * GET /robots.txt — allows everything and points to the sitemap. A function and not a file in public/, because the
 * Sitemap line needs an absolute URL and the host differs between production and a preview (#220).
 */

export const onRequestGet: PagesFunction = ({ request }) => {
  const origin = new URL(request.url).origin
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.txt\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  })
}

// A HEAD request does not reach onRequestGet (seen under `pages dev`): `curl -I` got the app's index.html.
export const onRequestHead = onRequestGet
