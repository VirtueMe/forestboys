/**
 * What is wrong with the structure inside a description's blocks (#128).
 *
 * The page turns Portable Text into HTML (blocksToHtml), and some stored descriptions break it in ways
 * nobody sees until a page looks odd. This names them, for the list at /admin/quality/html. Pure, so
 * the endpoint and the tests run the same code; nothing here rewrites a description (the editor fixes).
 *
 * The heading kinds are not decided here: they are src/utils/headingOutline.ts, the same check the save
 * endpoints run, so the list and a refused save cannot disagree. A description is judged as its entity's
 * sections together, in order, because the page shows them under one section heading.
 */

import { isTextBlock, walkBlocks } from './blockTree.ts'
import { checkContents, headingMessage, type OutlineOptions } from './headingOutline.ts'
import type { SanityBlock } from './portableText.ts'

export type BlockKind =
  | 'empty-heading'       // a heading with no text renders as <h3></h3>
  | 'heading-outline'     // too shallow for the section, or a skipped level (#127)
  | 'unused-definition'   // a markDef (link or person) no span uses
  | 'stray-list-level'    // a `level` on a block that is not a list item
  | 'list-level-jump'     // a list item two or more levels deeper than the item before it
  | 'dangling-mark'       // a span names a mark that has no definition
  | 'typed-markup'        // <br>, <b>, &nbsp; and the like typed into the text

export interface BlockFinding {
  kind:     BlockKind
  /** Which of the entity's sections it is in. */
  content:  number
  blockKey: string
  /** The words of the block, cut short. */
  text:     string
  /** What is wrong, in a sentence. */
  detail:   string
}

/** The marks blocksToHtml draws without a definition. */
const DECORATORS = new Set(['strong', 'em', 'underline', 'strike-through', 'code'])

/** A tag or an entity: what pasted HTML leaves in the text. A lone `<` or `&` is ordinary text. */
const TYPED_MARKUP = /<\/?[a-z][a-z0-9]*(?:\s[^>]*)?\/?>|&(?:nbsp|amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/i

const SNIPPET = 80

const textOf = (b: SanityBlock) => (b.children ?? []).map(c => c.text ?? '').join('')
const snippet = (s: string) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > SNIPPET ? `${t.slice(0, SNIPPET - 1)}…` : t }

type Found = Omit<BlockFinding, 'content'>

/**
 * The findings that need one block, or the block before it. Headings are left to `checkSections`.
 * The walk goes into boxes and tables (#314): each list of blocks is judged on its own, so the first block of a
 * cell has no «block before», and a list in one cell is not compared with the list in the next.
 */
export function checkBlocks(blocks: unknown): Found[] {
  const out: Found[] = []

  walkBlocks(blocks, (b, { previous }) => {
    const before = isTextBlock(previous) ? previous : undefined     // the block just before in its own list, for the list levels
    const base = { blockKey: b._key, text: snippet(textOf(b)) }
    const spans = b.children ?? []

    if (b.level !== undefined && !b.listItem) {
      out.push({ ...base, kind: 'stray-list-level', detail: `Nivå ${b.level} på en blokk som ikke er et listepunkt.` })
    }

    if (b.listItem && before?.listItem) {
      const level = b.level ?? 1
      const above = before.level ?? 1
      if (level >= above + 2) {
        out.push({ ...base, kind: 'list-level-jump', detail: `Listepunktet er på nivå ${level}, rett etter nivå ${above}.` })
      }
    }

    const used    = new Set(spans.flatMap(s => s.marks ?? []))
    const defined = new Set((b.markDefs ?? []).map(d => d._key))

    for (const def of b.markDefs ?? []) {
      if (used.has(def._key)) continue
      const what = def._type === 'person' ? `Personmerket «${def.name ?? def.slug ?? ''}»` : def._type === 'link' ? `Lenken «${def.href ?? ''}»` : `Definisjonen «${def._type}»`
      out.push({ ...base, kind: 'unused-definition', detail: `${what} brukes ikke av noen tekst.` })
    }

    for (const s of spans) {
      for (const m of s.marks ?? []) {
        if (defined.has(m) || DECORATORS.has(m)) continue
        out.push({ ...base, kind: 'dangling-mark', detail: `Teksten «${snippet(s.text ?? '')}» har merket «${m}», som ikke er definert.` })
      }
      const typed = TYPED_MARKUP.exec(s.text ?? '')
      if (typed) out.push({ ...base, kind: 'typed-markup', detail: `Teksten inneholder «${typed[0]}».` })
    }
  })
  return out
}

/** The blocks of a stored description; content that is not JSON, or not a list, counts as no blocks. */
export const parseBlocks = (content: string | null | undefined): unknown[] => {
  try { const v = JSON.parse(content ?? '') as unknown; return Array.isArray(v) ? v : [] } catch { return [] }
}

/**
 * Everything wrong in one entity's sections (each a JSON string of blocks, in order): the heading
 * outline across all of them, then the block findings of each.
 */
export function checkSections(contents: string[], options?: OutlineOptions): BlockFinding[] {
  const out: BlockFinding[] = []

  const blocksOf = contents.map(parseBlocks)
  for (const p of checkContents(contents, options)) {
    out.push({
      kind:     p.reason === 'empty' ? 'empty-heading' : 'heading-outline',
      content:  p.content,
      blockKey: p.blockKey,
      text:     snippet(p.text),
      detail:   headingMessage({ ...p, text: snippet(p.text) }, options),   // the message names the heading; a long one is cut like the row's text
    })
  }

  blocksOf.forEach((blocks, content) => {
    for (const f of checkBlocks(blocks)) out.push({ ...f, content })
  })
  return collapseUnused(out)
}

/**
 * An import left the same unused link on every block of some descriptions (a crew list holds it 60 times),
 * one defect that would fill the list with rows. Say it once per section, at its first block, and how many
 * blocks more carry it.
 */
function collapseUnused(findings: BlockFinding[]): BlockFinding[] {
  const first = new Map<string, BlockFinding>()
  const more = new Map<string, number>()
  const out: BlockFinding[] = []
  for (const f of findings) {
    if (f.kind !== 'unused-definition') { out.push(f); continue }
    const key = `${f.content}\u0000${f.detail}`
    if (first.has(key)) { more.set(key, (more.get(key) ?? 0) + 1); continue }
    first.set(key, f)
    out.push(f)
  }
  return out.map(f => {
    const n = f.kind === 'unused-definition' ? more.get(`${f.content}\u0000${f.detail}`) : undefined
    return n ? { ...f, detail: `${f.detail} Det samme i ${n} blokker til.` } : f
  })
}
