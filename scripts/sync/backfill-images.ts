/**
 * Copy the Sanity photos to our bucket (#412, epic #405).
 *
 * Every Source on Sanity's image CDN (whichever edge reaches it, or none), and every image a
 * description links to, is fetched as the original (`?dlRaw=true`, SHA-1 checked against the asset
 * id), stored through the door (master, 400 and 900 px WebP), and the graph is pointed at it:
 * `Source.url` becomes `/images/<id>`, the Sanity key stays on the node as `sanityKey`, and
 * the links in `Description.content` become `/images/<id>?w=900`.
 *
 * A dry run unless --write. The dry run does the whole job (download, check, JPEG XL, sizes) into a
 * sink that discards the files, so its report is the real one; it writes nothing to the bucket, the copied-list or
 * the graph. With --write the S3 credentials of the IMAGES bucket are needed (R2_*, scripts/README.md).
 * Local graph unless --production; production needs an explicit go-ahead each time.
 *
 * Also the sync's last step (#413): a photo that arrives from Sanity is a Source on its CDN until this runs, so the
 * daily workflow runs it right after the syncs. The sync recognises a photo before and after the copy (sanity-image.ts).
 *
 * Idempotent: the copied-list (`_meta/copied.json`) says what is in the bucket, so a second run fetches nothing.
 * Zero failures or it exits 1; a failed image keeps its Sanity address until a later run copies it.
 *
 * Usage: npx tsx scripts/sync/backfill-images.ts [--production] [--write] [--limit=N] [--ext=heif,gif] [--concurrency=N]
 *   --limit=N   only the first N images that still need copying (a trial run)
 *   --ext=a,b   only these file types (heif,gif,webp,avif,jpg,png)
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import neo4j from 'neo4j-driver'
import { loadEnv, WRITE } from '../lib/env.ts'
import { neo4jDriver } from '../lib/person-sync.ts'
import { S3Bucket, s3ConfigFromEnv } from '../lib/s3-bucket.ts'
import { openManifest, type Manifest } from '../../functions/_lib/image-manifest.ts'
import type { ImageBucket } from '../../functions/_lib/store-image.ts'
import {
  copyImage, downloadOriginal, makeMaster, parseSanityUrl, pool, rewriteDescriptionLinks, sharpMaker,
  type CopyResult, type SanityImage,
} from '../lib/image-backfill.ts'
import {
  DESCRIPTIONS_QUERY, KNOWN_ASSETS_QUERY, SET_CONTENT_QUERY, SET_URL_QUERY, SOURCES_QUERY, missingAssets, placeKind,
} from '../lib/image-backfill-graph.ts'
loadEnv()

const MAX_BYTES = 60 * 1024 * 1024
const BATCH = 100

const flag = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const LIMIT = flag('limit') ? Number(flag('limit')) : Infinity
const EXT = flag('ext')?.split(',')
const CONCURRENCY = Number(flag('concurrency') ?? 6)

const MB = (b: number) => `${(b / 1e6).toFixed(1)} MB`
const asInt = (v: unknown): number => (neo4j.isInt(v) ? v.toNumber() : (v as number))

interface SourceRow { id: string, url: string, ref: string | null, places: string[] }

/** The files go nowhere: the dry run's stand-in for the bucket. */
function sink(): { bucket: ImageBucket, bytes: () => number } {
  let total = 0
  return {
    bucket: { head: () => Promise.resolve(null), put: (_k, v) => { total += v.length; return Promise.resolve() } },
    bytes:  () => total,
  }
}

async function sanityReferencedAssets(token: string): Promise<Set<string> | null> {
  try {
    const q = encodeURIComponent('*[_type == "sanity.imageAsset" && count(*[references(^._id)]) > 0]._id')
    const r = await fetch(`https://7r6kqtqy.api.sanity.io/v2024-01-01/data/query/production?query=${q}`, { headers: { authorization: `Bearer ${token}` } })
    if (!r.ok) return null
    return new Set(((await r.json()) as { result: string[] }).result)
  } catch { return null }
}

async function main() {
  const token = process.env.SANITY_READ_TOKEN
  if (!token) throw new Error('SANITY_READ_TOKEN is not set (.env / .env.production): the originals need a read token')

  // The bucket and the copied-list. A dry run may read the list (production) but never writes it.
  let s3: S3Bucket | null = null
  try { s3 = new S3Bucket(s3ConfigFromEnv()) } catch (e) { if (WRITE) throw e }
  const out = sink()
  const store = WRITE ? s3!.imageBucket() : out.bucket
  const manifestStore = s3?.manifestStore()
  const manifest: Manifest = await openManifest(manifestStore ?? { read: () => Promise.resolve(null), write: () => Promise.resolve(null) })
  const record = (k: string) => (WRITE ? manifest.record(k) : Promise.resolve())
  console.log(`copied-list: ${manifest.size()} images${s3 ? '' : ' (no S3 credentials: empty)'}`)

  const driver = neo4jDriver()
  const session = driver.session({ defaultAccessMode: WRITE ? neo4j.session.WRITE : neo4j.session.READ })
  const failures: { what: string, error: string }[] = []
  const stats = { copied: 0, existed: 0, skipped: 0, original: 0, master: 0, jxl: 0, kept: 0, jxlFailed: [] as string[] }
  const byPlace = new Map<string, { sources: number, copied: number, skipped: number, failed: number }>()
  const place = (k: string) => { if (!byPlace.has(k)) byPlace.set(k, { sources: 0, copied: 0, skipped: 0, failed: 0 }); return byPlace.get(k)! }

  try {
    // 1. What there is to copy.
    const sources: SourceRow[] = (await session.run(SOURCES_QUERY)).records.map(r => r.toObject() as unknown as SourceRow)
    const descs = (await session.run(DESCRIPTIONS_QUERY)).records.map(r => ({ id: r.get('id') as string, content: r.get('content') as string }))

    const images = new Map<string, SanityImage>()
    const kindOf = new Map<string, string>()          // image id -> place of its first Source
    const bad: SourceRow[] = []
    for (const s of sources) {
      const img = parseSanityUrl(s.url)
      if (!img) { bad.push(s); continue }
      images.set(img.id, img)
      if (!kindOf.has(img.id)) kindOf.set(img.id, placeKind(s.places))
      place(placeKind(s.places)).sources++
    }
    const linkImages = new Map<string, SanityImage>()
    for (const d of descs) {
      for (const img of rewriteDescriptionLinks(d.content, new Set()).images) {
        if (!images.has(img.id)) { linkImages.set(img.id, img); kindOf.set(img.id, 'description link only') }
      }
    }
    const all = [...images.values(), ...linkImages.values()]
    const todo = all.filter(i => !manifest.has(i.key) && (!EXT || EXT.includes(i.ext)))
    const batch = todo.slice(0, Number.isFinite(LIMIT) ? LIMIT : todo.length)
    console.log(`${sources.length} Sources on Sanity's CDN (${images.size} distinct images), ${descs.length} descriptions with ${linkImages.size} more images only they link to`)
    console.log(`${all.filter(i => manifest.has(i.key)).length} already in the copied-list; copying ${batch.length}${batch.length < todo.length ? ` of ${todo.length} (--limit)` : ''}${EXT ? ` (only ${EXT.join(', ')})` : ''}, ${CONCURRENCY} at a time${WRITE ? '' : ' — dry run, files are discarded'}`)
    for (const b of bad) failures.push({ what: b.id, error: `not a Sanity image url: ${b.url}` })

    // 2. Copy.
    const done = new Set(all.filter(i => manifest.has(i.key)).map(i => i.id))
    let n = 0
    const started = Date.now()
    const results = await pool(batch, CONCURRENCY, async (img): Promise<CopyResult> => {
      const r = await copyImage(img, {
        download: i => downloadOriginal(i, { token }),
        bucket:   store,
        maker:    sharpMaker,
        makeMaster,
        manifest: { has: k => manifest.has(k), record },
        maxBytes: MAX_BYTES,
      })
      if (++n % 50 === 0) console.log(`  ${n}/${batch.length}  ${Math.round((Date.now() - started) / 1000)} s`)
      return r
    })
    results.forEach((r, i) => {
      const img = batch[i]
      const p = place(kindOf.get(img.id) ?? 'description link only')
      if (!r.ok) { failures.push({ what: img.key, error: r.error.message }); p.failed++; return }
      done.add(img.id)
      const v = r.value
      if (v.status === 'copied') { stats.copied++; p.copied++ } else if (v.status === 'existed') { stats.existed++; p.copied++ } else { stats.skipped++; p.skipped++ }
      stats.original += v.originalBytes
      stats.master += v.masterBytes
      if (v.how === 'jxl') stats.jxl++
      else if (v.how === 'jxl-failed') stats.jxlFailed.push(`${img.key}: ${v.why}`)
      else stats.kept++
    })
    if (WRITE) await manifest.flush()

    // 3. Point the graph at the bucket: only what is in the bucket.
    let sourcesSet = 0
    let descsSet = 0
    const rows = sources.flatMap(s => {
      const img = parseSanityUrl(s.url)
      return img && done.has(img.id) ? [{ id: s.id, url: `/images/${img.id}`, key: img.key }] : []
    })
    const descRows = descs.flatMap(d => {
      const r = rewriteDescriptionLinks(d.content, done)
      return r.left.length ? [] : [{ id: d.id, before: d.content, after: r.content }]
    })
    const leftDescs = descs.length - descRows.length
    if (WRITE) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const dir = resolve(process.cwd(), 'data', 'image-backfill')
      mkdirSync(dir, { recursive: true })
      // The way back: the text of every description about to change.
      writeFileSync(resolve(dir, `descriptions-before-${stamp}.json`), JSON.stringify(descRows.map(d => ({ id: d.id, content: d.before }))))
      for (let i = 0; i < rows.length; i += BATCH) sourcesSet += asInt((await session.run(SET_URL_QUERY, { rows: rows.slice(i, i + BATCH) })).records[0].get('n'))
      for (let i = 0; i < descRows.length; i += BATCH) descsSet += asInt((await session.run(SET_CONTENT_QUERY, { rows: descRows.slice(i, i + BATCH) })).records[0].get('n'))
    }

    // 4. Report.
    console.log('\n--- report ---')
    console.log(`images: ${stats.copied} copied, ${stats.existed} already in the bucket, ${stats.skipped} skipped by the list, ${failures.length} failed`)
    console.log(`masters: ${MB(stats.master)} against ${MB(stats.original)} of originals (${stats.original ? Math.round(100 * stats.master / stats.original) : 0}%); ${stats.jxl} JPEG XL, ${stats.kept} original bytes, ${stats.jxlFailed.length} JPEG XL refused`)
    for (const j of stats.jxlFailed) console.log(`  kept original: ${j}`)
    if (!WRITE) console.log(`display files that would be written: ${MB(out.bytes())} (masters not included)`)
    console.log('by place:')
    for (const [k, v] of [...byPlace.entries()].sort()) console.log(`  ${k.padEnd(28)} ${String(v.sources).padStart(5)} sources  ${v.copied} copied  ${v.skipped} skipped  ${v.failed} failed`)
    console.log(`graph: ${WRITE ? `${sourcesSet} Sources and ${descsSet} descriptions rewritten` : `${rows.length} Sources and ${descRows.length} descriptions would be rewritten`}${leftDescs ? `; ${leftDescs} descriptions left (an image not copied)` : ''}`)

    const referenced = await sanityReferencedAssets(token)
    if (referenced) {
      const known = (await session.run(KNOWN_ASSETS_QUERY)).records.map(r => r.get('id') as string)
      const missing = missingAssets(referenced, known)
      console.log(`Sanity assets referenced by a document but not in the graph: ${missing.length} of ${referenced.size}`)
      if (missing.length) {
        mkdirSync(resolve(process.cwd(), 'data', 'image-backfill'), { recursive: true })
        writeFileSync(resolve(process.cwd(), 'data', 'image-backfill', 'not-in-graph.json'), JSON.stringify(missing, null, 1))
        console.log('  listed in data/image-backfill/not-in-graph.json')
      }
    } else {
      console.log('Sanity assets not in the graph: not checked (the query failed)')
    }

    if (failures.length) {
      console.error(`\n${failures.length} FAILED:`)
      for (const f of failures.slice(0, 50)) console.error(`  ${f.what}: ${f.error}`)
      process.exitCode = 1
    }
    if (!WRITE) console.log('\nDry run: nothing was written. Pass --write to copy.')
  } finally {
    if (WRITE) await manifest.flush().catch(() => {})
    await session.close()
    await driver.close()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
