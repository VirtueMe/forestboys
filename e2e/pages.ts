/**
 * The pages the design checks run on (#139): one representative page per kind, recorded from the local
 * graph (`npm run e2e:record`) and replayed in the tests, so they need no graph. A page is chosen for being
 * rich (description, relations, images, links) and not too big. Add a kind here, record it, and the checks
 * that loop over PAGES cover it.
 *
 * They stand for the *template* of a kind: its header, its panes, its chrome. The headings inside a
 * description are content, and some stored descriptions break the heading rules (#127 stops them being
 * saved that way and offers the repair; the old ones are still there). A page whose description does would
 * fail the outline check for the content's sake, so pick one whose description is clean.
 */
export interface PageTarget {
  kind: string
  slug: string
  path: string
  /** Part of the page's title, to know the right page rendered. */
  title: string
  /** How many headings the page has at least; two (a title and a section) unless it is a list. */
  minHeadings?: number
}

export const PAGES: PageTarget[] = [
  { kind: 'person',   slug: 'bernt-balchen',   path: '/person/bernt-balchen',   title: 'Bernt Balchen' },
  { kind: 'station',  slug: 'raf-harrington',  path: '/station/raf-harrington', title: 'RAF Harrington' },
  { kind: 'location', slug: 'lamholmen',       path: '/location/lamholmen',     title: 'Lamholmen' },
  { kind: 'organization', slug: 'british-commandos', path: '/organization/british-commandos', title: 'British Commandos' },
  { kind: 'unit',      slug: '02-soe',           path: '/district/02-soe',        title: '02-SOE' },
  { kind: 'equipment', slug: 'berit',            path: '/equipment/berit',        title: 'BERIT' },
  { kind: 'transport', slug: '37-fly',           path: '/transport/37-fly',       title: '37 fly' },
  { kind: 'outline',   slug: 'eksportgruppe-torsvik', path: '/outlines/eksportgruppe-torsvik', title: 'Eksportgruppe' },
  { kind: 'event',     slug: 'forste-mote-om-mostandsbevegelse-i-london', path: '/events/forste-mote-om-mostandsbevegelse-i-london', title: 'Første møte' },
  { kind: 'events',    slug: 'list',             path: '/events',                 title: 'Hendelser', minHeadings: 1 },
]

/** Where the recording of a page is kept. */
export const fixturePath = (t: PageTarget) => `e2e/fixtures/${t.kind}-${t.slug}.json`
