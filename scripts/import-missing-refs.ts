/**
 * Import the Locations, Stations and Transports that Sanity events refer to
 * but the graph doesn't have yet — new in Sanity since the April import —
 * so the event re-import (scripts/reimport-events.ts) can link them.
 *
 * Same rule as migration/src/linge/round_one.clj (location-cypher,
 * station-cypher, transport-cypher): scalar props, Sanity-fed claims as
 * `<field>`, `<field>_state: 'candidate'`, `<field>_sourceRef`; images and
 * links as for events (galleries.clj, external_sources.clj).
 *
 * Organizations and districts are shaped by hand in the graph — those
 * references are only listed.
 *
 * Usage: npx tsx scripts/import-missing-refs.ts [--write]
 */

import neo4j from 'neo4j-driver'
import * as dotenv from 'dotenv'
import { imageSources, isImportableUrl, linkSource, sanMigRef } from './lib/person-rule.ts'
import { API, neo4jDriver, type Doc } from './lib/person-sync.ts'
import { fetchSanityEvents } from './lib/event-sync.ts'
dotenv.config()

const write = process.argv.includes('--write')

const ref  = (v: unknown): string => ((v as { _ref?: string } | undefined)?._ref ?? '')
const refs = (v: unknown): string[] => ((v as { _ref?: string }[] | undefined) ?? []).map(r => r?._ref ?? '').filter(Boolean)
const str  = (v: unknown): string => (typeof v === 'string' ? v : '')

const KINDS = [
  { label: 'Location',  type: 'location',  fields: ['locationFrom', 'locationTo'] },
  { label: 'Station',   type: 'station',   fields: ['stationFrom', 'stationTo'] },
  { label: 'Transport', type: 'transport', fields: ['transport'] },
] as const

async function fetchDocs(ids: string[]): Promise<Doc[]> {
  if (!ids.length) return []
  const url = new URL(API)
  url.searchParams.set('query', `*[_id in $ids]`)
  url.searchParams.set('$ids', JSON.stringify(ids))
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Sanity ${res.status}`)
  return (await res.json() as { result: Doc[] }).result
}

/** round_one.clj: the node's props, claims flattened. */
function nodeProps(label: string, d: Doc): Record<string, unknown> {
  const p: Record<string, unknown> = {
    slug: str((d.slug as { current?: string } | undefined)?.current),
    canonicalName: label === 'Transport' ? str(d.name) : str(d.title),
    sanityId: d._id, sanityUpdatedAt: d._updatedAt,
  }
  const claim = (prop: string, value: unknown, field: string) => {
    if (value === undefined || value === null || value === '') return
    p[prop] = value
    p[`${prop}_state`] = 'candidate'
    p[`${prop}_sourceRef`] = sanMigRef(label.toLowerCase(), d._id, field)
  }
  const c = d.coordinates as { lat?: number; lng?: number } | undefined
  if (label === 'Location' || label === 'Station') {
    if (label === 'Station') claim('type', d.type, 'type')
    claim('lat', c?.lat, 'coordinates')
    claim('lng', c?.lng, 'coordinates')
  }
  if (label === 'Transport') {
    claim('type', d.type, 'type')
    claim('regser', d.regser, 'regser')
    claim('reserve', d.reserve, 'reserve')
    claim('rawUnit', d.unit, 'unit')
  }
  return p
}

async function main() {
  const events = await fetchSanityEvents()
  const driver = neo4jDriver()
  const read = driver.session({ defaultAccessMode: neo4j.session.READ })
  try {
    const plans: { label: string; docs: Doc[] }[] = []
    for (const k of KINDS) {
      const have = new Set((await read.run(`MATCH (n:\`${k.label}\`) WHERE n.sanityId IS NOT NULL RETURN n.sanityId AS id`))
        .records.map(r => r.get('id') as string))
      const wanted = new Set(events.flatMap(e => k.fields.flatMap(f => (f === 'transport' ? refs(e[f]) : [ref(e[f])]))).filter(Boolean))
      const missing = [...wanted].filter(id => !have.has(id))
      const docs = (await fetchDocs(missing)).filter(d => d._type === k.type)
      const notFound = missing.filter(id => !docs.some(d => d._id === id))
      plans.push({ label: k.label, docs })
      console.log(`${k.label}: ${missing.length} referenced but missing — ${docs.length} found in Sanity${notFound.length ? `, ${notFound.length} not (deleted or drafts): ${notFound.slice(0, 3).join(', ')}` : ''}`)
      for (const d of docs.slice(0, 50)) {
        const p = nodeProps(k.label, d)
        const at = p.lat !== undefined ? ` (${JSON.stringify(p.lat)}, ${JSON.stringify(p.lng)})` : ''
        console.log(`  ${str(p.slug)} — ${str(p.canonicalName)}${at}`)
      }
    }

    // Organizations and districts: list only.
    for (const [field, label] of [['organization', 'Organization'], ['district', 'Unit']] as const) {
      const have = new Set((await read.run(`MATCH (n:\`${label}\`) WHERE n.sanityId IS NOT NULL RETURN n.sanityId AS id`)).records.map(r => r.get('id') as string))
      const missing = [...new Set(events.map(e => ref(e[field])).filter(id => id && !have.has(id)))]
      const docs = await fetchDocs(missing)
      for (const d of docs) {
        const users = events.filter(e => ref(e[field]) === d._id).map(e => str((e.slug as { current?: string }).current))
        console.log(`${label} not in the graph (by hand): ${str(d.name) || str(d.title)} (${d._id}) — used by ${users.join(', ')}`)
      }
    }

    // Slugs already held by another node of the same label.
    const errors: string[] = []
    for (const p of plans) {
      const slugs = p.docs.map(d => str((d.slug as { current?: string } | undefined)?.current))
      const taken = (await read.run(`MATCH (n:\`${p.label}\`) WHERE n.slug IN $slugs RETURN n.slug AS slug`, { slugs })).records.map(r => r.get('slug') as string)
      for (const s of taken) errors.push(`${p.label} slug taken: ${s}`)
      for (const d of p.docs) if (!str((d.slug as { current?: string } | undefined)?.current)) errors.push(`${p.label} without slug: ${d._id}`)
    }
    if (errors.length) console.log(`\nErrors:\n  ${errors.join('\n  ')}`)

    if (!write) { console.log('\n(dry run — pass --write to apply)'); return }
    if (errors.length) { process.exitCode = 1; return }

    const ws = driver.session({ defaultAccessMode: neo4j.session.WRITE })
    try {
      for (const p of plans) {
        for (const d of p.docs) {
          const props = nodeProps(p.label, d)
          const images = imageSources(d.gallery).map(i => ({ ...i, caption: i.caption ?? null }))
          const titles = new Map(((d.links as { link?: string; title?: string }[] | undefined) ?? []).map(l => [l.link ?? '', l.title]))
          const links = [...titles.keys()].filter(isImportableUrl).map(u => linkSource(u, titles.get(u)))
          await ws.executeWrite(async tx => {
            await tx.run(`CREATE (n:\`${p.label}\`) SET n = $props`, { props })
            await tx.run(`
              MATCH (n:\`${p.label}\` {sanityId: $id})
              UNWIND $images AS img
              MERGE (s:Source {id: img.id})
                ON CREATE SET s.type = 'photograph', s.url = img.url, s.sanityAssetRef = img.assetRef
              MERGE (n)-[h:HAS_IMAGE]->(s) SET h.order = img.order, h.caption = img.caption`, { id: d._id, images })
            await tx.run(`
              MATCH (n:\`${p.label}\` {sanityId: $id})
              UNWIND $links AS src
              MERGE (s:Source {id: src.id}) ON CREATE SET s += src
              MERGE (n)-[:REFERENCED_IN]->(s)`, { id: d._id, links })
          })
        }
        console.log(`Created ${p.docs.length} ${p.label}.`)
      }
    } finally {
      await ws.close()
    }
  } finally {
    await read.close()
    await driver.close()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
