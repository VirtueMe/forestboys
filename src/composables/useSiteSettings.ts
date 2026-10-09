import { ref } from 'vue'

export interface SiteSettings {
  name: string
  shortName: string
}

// The same defaults as functions/_lib/site-settings.ts: they show until the answer arrives, or if it never does.
const DEFAULTS: SiteSettings = { name: 'Milorg 2 Utforsker', shortName: 'Milorg 2' }

const site = ref<SiteSettings>({ ...DEFAULTS })
let started = false

/** The site's name, set by an admin (/admin/site). Fetched once; the public default shows meanwhile. */
export function useSiteSettings() {
  if (!started) {
    started = true
    fetch('/api/site-settings/site')
      .then(res => (res.ok ? res.json() : null))
      .then((body: Partial<SiteSettings> | null) => {
        if (body?.name && body.shortName) site.value = { name: body.name, shortName: body.shortName }
      })
      .catch(() => { /* the defaults stay */ })
  }
  return { site }
}
