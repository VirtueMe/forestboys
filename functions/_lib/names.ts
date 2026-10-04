/**
 * Names — `(:Station)-[:HAS_NAME]->(:Name)`, the other names a place went by
 * (docs/SCHEMA.md, "Name"). `canonicalName` stays the one display name; a
 * Name is a former name, a later one, or a plain alias.
 *
 * Node properties: `id` (stable across saves), `order` (position in the
 * editor list), `value`, `type` (`former` | `later` | `alias`), `from` / `to`
 * (partial dates, see ./period.ts, each end optional), `fromAbout` /
 * `toAbout` (the date is approximate — "omkring"), `sourceRefs` (evidence,
 * ./source-refs.ts).
 *
 * Shared by the save endpoint(s); a Station is the only owner so far.
 */

import { runCypher, runCypherTx, type Neo4jEnv } from './neo4j.ts'
import { DATE_RE, periodError } from './period.ts'
import { parseSourceRefs, unknownSources } from './source-refs.ts'

export const NAME_TYPES = ['former', 'later', 'alias'] as const
export type NameType = typeof NAME_TYPES[number]

export const MAX_NAMES = 50
export const MAX_NAME_LENGTH = 200

/** One name after validation. `id` is null for a name that has none yet. */
export interface CleanName {
  id:         string | null
  value:      string
  type:       NameType
  from:       string | null
  fromAbout:  boolean
  to:         string | null
  toAbout:    boolean
  sourceRefs: string[]
}

type Raw = Record<string, unknown>

function dateOrNull(v: unknown): string | null | undefined {
  if (v === undefined || v === null || v === '') return null
  return typeof v === 'string' && DATE_RE.test(v) ? v : undefined
}

/** Norwegian error for a bad list, or the cleaned names (order kept). */
export function validateNames(v: unknown): { names: CleanName[] } | { error: string } {
  if (!Array.isArray(v)) return { error: 'names må være en liste' }
  if (v.length > MAX_NAMES) return { error: `For mange navn (maks ${MAX_NAMES})` }

  const names: CleanName[] = []
  const seen = new Set<string>()
  for (const raw of v as Raw[]) {
    if (!raw || typeof raw !== 'object') return { error: 'Ugyldig navn' }

    const value = typeof raw.value === 'string' ? raw.value.trim() : ''
    if (!value) return { error: 'Navnet kan ikke være tomt' }
    if (value.length > MAX_NAME_LENGTH) return { error: `Navnet er for langt (maks ${MAX_NAME_LENGTH} tegn): ${value.slice(0, 30)}…` }

    if (!(NAME_TYPES as readonly unknown[]).includes(raw.type)) {
      return { error: `Ugyldig type for «${value}»: bruk ${NAME_TYPES.join(', ')}` }
    }
    const type = raw.type as NameType

    const from = dateOrNull(raw.from)
    const to   = dateOrNull(raw.to)
    if (from === undefined || to === undefined) {
      return { error: `Ugyldig dato for «${value}» — bruk ÅÅÅÅ, ÅÅÅÅ-MM eller ÅÅÅÅ-MM-DD` }
    }
    const period = periodError(from, to)
    if (period) return { error: `«${value}»: ${period}` }
    for (const k of ['fromAbout', 'toAbout'] as const) {
      if (raw[k] !== undefined && raw[k] !== null && typeof raw[k] !== 'boolean') {
        return { error: `Ugyldig ${k} for «${value}»` }
      }
    }

    const refs = parseSourceRefs(raw.sourceRefs)
    if ('error' in refs) return { error: `«${value}»: ${refs.error}` }

    if (raw.id !== undefined && raw.id !== null && (typeof raw.id !== 'string' || !raw.id)) {
      return { error: `Ugyldig id for «${value}»` }
    }

    const key = `${type}\u0000${value.toLowerCase()}`
    if (seen.has(key)) return { error: `«${value}» er oppgitt to ganger` }
    seen.add(key)

    names.push({
      id:         typeof raw.id === 'string' ? raw.id : null,
      value, type, from, to,
      // "About" only means something when there is a date to be about.
      fromAbout:  from !== null && raw.fromAbout === true,
      toAbout:    to   !== null && raw.toAbout   === true,
      sourceRefs: refs.refs,
    })
  }
  return { names }
}

/**
 * Replace every Name on the Station, atomically. Returns the ids in input
 * order; a name keeps its id when the client sends one this Station owns,
 * anything else gets a fresh id.
 */
export async function replaceStationNames(
  env:   Neo4jEnv,
  slug:  string,
  names: CleanName[],
): Promise<{ ids: string[] } | { error: string; status: number }> {
  const [station] = await runCypher<{ name: string | null }>(env,
    `MATCH (s:Station {slug: $slug}) RETURN coalesce(s.canonicalName, s.title) AS name`, { slug }, 'Read')
  if (!station) return { error: 'Stasjonen finnes ikke', status: 404 }

  const own = (station.name ?? '').trim().toLowerCase()
  const same = names.find(n => n.value.toLowerCase() === own)
  if (same) return { error: `«${same.value}» er stasjonens eget navn — legg det ikke til som et annet navn`, status: 400 }

  const missingSources = await unknownSources(env, names.flatMap(n => n.sourceRefs))
  if (missingSources.length) return { error: `Kilden finnes ikke: ${missingSources.join(', ')}`, status: 400 }

  const old = await runCypher<{ id: string }>(env,
    `MATCH (:Station {slug: $slug})-[:HAS_NAME]->(n:Name) RETURN n.id AS id`, { slug }, 'Read')
  const oldIds = new Set(old.map(o => o.id))
  const used = new Set<string>()
  const items = names.map((n, i) => {
    const keep = n.id !== null && oldIds.has(n.id) && !used.has(n.id)
    const id = keep ? n.id! : crypto.randomUUID()
    used.add(id)
    return { ...n, id, order: i + 1 }
  })

  const params = { slug, items }
  await runCypherTx(env, [
    { statement: `MATCH (:Station {slug: $slug})-[:HAS_NAME]->(n:Name) DETACH DELETE n`, parameters: params },
    {
      statement: `
        MATCH (s:Station {slug: $slug})
        UNWIND $items AS n
        CREATE (s)-[:HAS_NAME]->(:Name {
          id: n.id, order: n.order, value: n.value, type: n.type,
          from: n.from, fromAbout: n.fromAbout, to: n.to, toAbout: n.toAbout,
          sourceRefs: n.sourceRefs
        })`,
      parameters: params,
    },
  ])
  return { ids: items.map(i => i.id) }
}
