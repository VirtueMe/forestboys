/**
 * The pages the design checks run on (#139): one representative page per kind, recorded from the local
 * graph (`npm run e2e:record`) and replayed in the tests, so they need no graph. A page is chosen for being
 * rich (description, relations, images, links) and not too big. Add a kind here, record it, and the checks
 * that loop over PAGES cover it.
 */
export interface PageTarget {
  kind: string
  slug: string
  path: string
  /** Part of the page's h1, to know the right page rendered. */
  title: string
}

export const PAGES: PageTarget[] = [
  { kind: 'person',   slug: 'bernt-balchen',   path: '/person/bernt-balchen',   title: 'Bernt Balchen' },
  { kind: 'station',  slug: 'raf-harrington',  path: '/station/raf-harrington', title: 'RAF Harrington' },
  { kind: 'location', slug: 'lamholmen',       path: '/location/lamholmen',     title: 'Lamholmen' },
]

/** Where the recording of a page is kept. */
export const fixturePath = (t: PageTarget) => `e2e/fixtures/${t.kind}-${t.slug}.json`
