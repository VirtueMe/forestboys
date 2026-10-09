/** The web app manifest, with the site's name from the setting (#153) in place of a fixed one. */

import type { SiteSettings } from './site-settings.ts'

export function buildManifest(site: SiteSettings) {
  return {
    name: site.name,
    short_name: site.shortName,
    description: 'Utforsk norsk motstandsbevegelse 1940–1945',
    // A fixed identity for the installed app, so a later change of start_url does not make it a new app.
    id: '/',
    start_url: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#F4EFE4',
    theme_color: '#F4EFE4',
    // The art is full-bleed, so the same file serves both purposes; they are declared apart because
    // 'any maskable' on one entry is discouraged.
    icons: [192, 512].flatMap(size => (['any', 'maskable'] as const).map(purpose => (
      { src: `/icons/icon-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose }
    ))),
  }
}
