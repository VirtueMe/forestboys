/**
 * How a recorded page finds its data again (#139). The pages get everything from `POST /api/neo4j/query`
 * (a Cypher query and its parameters in the body, `{ rows }` back), and CI has no graph, so a page is
 * recorded once from the local graph (record-fixtures.ts) and replayed (e2e/helpers/replay.ts). A request
 * is found again by its query, with the whitespace normalised, and its parameters, with the keys sorted:
 * the same call gives the same key however the code that made it is formatted.
 *
 * Pure, so the recorder and the replay cannot disagree about a key, and the rule is tested.
 */

/**
 * The admin the edit-mode pages are recorded and replayed as (#140): what `/auth/me` answers. The page shows
 * its edit mode for role `admin` and asks nothing else of it. One definition, so the recording and the replay
 * agree about who is looking.
 */
export const STAND_IN_ADMIN = { id: 'e2e-admin', email: 'admin@example.org', name: 'Admin', role: 'admin' } as const

export interface RecordedQuery {
  query: string
  params: Record<string, unknown>
  rows: unknown[]
  /** How many rows the graph answered, when the recording keeps fewer (see `capRows`). */
  truncatedFrom?: number
}

/**
 * The app loads whole registries into its caches on start-up, with queries that have no parameters
 * (every person, every event, every location: thousands of rows, megabytes). They are about no page in
 * particular and no page renders them whole, so a recording keeps the first rows of such a query and
 * says how many there were. A query with parameters is about the page and is never cut.
 */
export const CAP_ROWS = 25

/**
 * Cut a registry-wide query to CAP_ROWS rows, and say so. Two things keep the recording honest:
 *  - the rows are put in a fixed order first (by their JSON), because the graph answers a query with no
 *    ORDER BY in any order it likes, and a recording that changes every time it is made hides real changes;
 *  - rows that mention `mustKeep` (the page's own slug) are kept as well, because a page may look itself up
 *    in a registry (the events route finds its event in the list of events) and must find itself.
 */
export function capRows(query: string, params: Record<string, unknown>, rows: unknown[], mustKeep = ''): RecordedQuery {
  const global = Object.keys(params).length === 0
  if (!global || rows.length <= CAP_ROWS) return { query, params, rows }
  const sorted = rows.map(row => ({ row, text: stableStringify(row) })).sort((a, b) => (a.text < b.text ? -1 : a.text > b.text ? 1 : 0))
  const kept = sorted.filter((r, i) => i < CAP_ROWS || (mustKeep !== '' && r.text.includes(mustKeep)))
  return { query, params, rows: kept.map(r => r.row), truncatedFrom: rows.length }
}

/** A same-origin GET that the page made (the Sanity proxy under /sanity/): found again by its path and query. */
export interface RecordedGet {
  url: string
  status: number
  contentType: string
  body: string
}

export interface PageRecording {
  /** The page it was recorded from, as a path. */
  path: string
  queries: RecordedQuery[]
  gets: RecordedGet[]
}

export const normalizeQuery = (query: string) => query.replace(/\s+/g, ' ').trim()

/** JSON with the keys of every object in order, so equal values give equal text. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export const requestKey = (query: string, params: Record<string, unknown> = {}) =>
  `${normalizeQuery(query)}\u0000${stableStringify(params)}`

/** A short, readable form of a key, for a message about what was not found. */
export const describeRequest = (query: string, params: Record<string, unknown> = {}) => {
  const q = normalizeQuery(query)
  return `${q.length > 110 ? q.slice(0, 110) + '…' : q}  ${stableStringify(params).slice(0, 80)}`
}
