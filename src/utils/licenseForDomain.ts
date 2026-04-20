/**
 * External-source licensing defaults. Stores SPDX-style identifiers
 * (from the spdx-license-ids package) plus two project-local sentinels:
 *
 *   NOASSERTION           — SPDX-reserved for "not determined"
 *   LicenseRef-Copyright  — SPDX LicenseRef-* namespace for custom refs;
 *                           used when the content is simply in-copyright
 *                           and no open license applies.
 */

export const NOASSERTION           = 'NOASSERTION' as const
export const LICENSE_REF_COPYRIGHT = 'LicenseRef-Copyright' as const

export type License = string

/**
 * URL-host → SPDX license. Shared with migration/src/linge/external_sources.clj
 * (domain->license); keep the two in sync.
 */
const DOMAIN_LICENSE: Record<string, License> = {
  'lokalhistoriewiki.no':     'CC-BY-SA-3.0',            // dual-licensed; the CC-BY-SA branch is what we'd pick on reuse
  'no.wikipedia.org':         'CC-BY-SA-4.0',
  'en.wikipedia.org':         'CC-BY-SA-4.0',
  'nb.no':                    LICENSE_REF_COPYRIGHT,
  'media.digitalarkivet.no':  NOASSERTION,               // per-document — varies
}

const DOMAIN_ATTRIBUTION: Record<string, string> = {
  'lokalhistoriewiki.no':      'Lokalhistoriewiki, Nasjonalbiblioteket',
  'no.wikipedia.org':          'Wikipedia (no)',
  'en.wikipedia.org':          'Wikipedia (en)',
  'nb.no':                     'Nasjonalbiblioteket',
  'media.digitalarkivet.no':   'Arkivverket / Digitalarkivet',
  'krigsseilerregisteret.no':  'Krigsseilerregisteret',
  'fanger.no':                 'Fangeregisteret',
}

/** Legacy strings stored before we adopted SPDX — remap on read. */
const LEGACY_REMAP: Record<string, License> = {
  'copyright':          LICENSE_REF_COPYRIGHT,
  'unknown':            NOASSERTION,
  'varies':             NOASSERTION,
  'CC-BY-SA-3.0+GFDL':  'CC-BY-SA-3.0', // keep the CC half; GFDL rarely used on reuse
}

export function normalizeLicense(stored: string | null | undefined): License {
  if (!stored) return NOASSERTION
  return LEGACY_REMAP[stored] ?? stored
}

function hostOf(url: string): string | null {
  try { return new URL(url).host.replace(/^www\./, '') }
  catch { return null }
}

export function licenseForUrl(url: string | null | undefined): License {
  if (!url) return NOASSERTION
  const host = hostOf(url)
  return (host && DOMAIN_LICENSE[host]) ?? NOASSERTION
}

export function attributionForUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const host = hostOf(url)
  return (host && DOMAIN_ATTRIBUTION[host]) ?? null
}
