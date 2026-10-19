# Sanity Portable Text — block rendering guide

## Overview

Sanity stores rich text as **Portable Text** — an array of block objects.
This document describes all block types and inline marks found in the Milorg 2
dataset, and how to render them correctly in Vue.

---

## Block structure

Every block follows this shape:

```typescript
interface SanityBlock {
  _key: string
  _type: 'block'
  style: 'normal' | 'h1' | 'h2' | 'h3' | 'blockquote' | 'preformatted'
  children: SanitySpan[]
  markDefs: SanityMarkDef[]
}

interface SanitySpan {
  _key: string
  _type: 'span'
  text: string
  marks: string[]   // mark names ('strong', 'em') OR mark def keys (UUIDs)
}

interface SanityMarkDef {
  _key: string      // matches the UUID in span.marks[]
  _type: 'link'     // only link markDefs found in this dataset
  href: string
}
```

---

## Findings from the `home` document

### Cards

6 cards total — 4 top, 2 bottom:

| Card | Blocks |
|---|---|
| Oppstart Motstand i England og Norge | 5 |
| Innledning | 4 |
| Topp meny | 10 |
| Menystruktur | 3 |
| Slipp plasser | 11 |
| Linker brukt i arbeidet | 11 |

### Block styles found

Only `normal` — no headings or blockquotes in home cards.

### Inline marks found

| Mark | HTML equivalent | Notes |
|---|---|---|
| `strong` | `<strong>` | Used for `@Sizzling Viper` signatures and emphasis |
| `underline` | `<u>` | Used alongside `strong` on signatures |
| `link` (markDef) | `<a>` | Internal and external links |

### Link types

Links are stored as `markDefs` with `_type: 'link'`. The span's `marks[]`
array contains the `_key` of the markDef (a UUID), not the word "link".

**Internal links** — start with `/`:
```json
{ "_key": "8b2e9260f537", "_type": "link", "href": "/events/forste-mote-om-mostandsbevegelse-i-london" }
```

**External links** — full URLs:
```json
{ "_key": "abc123", "_type": "link", "href": "https://www.nb.no/items/..." }
```

---

## The `blocksToHtml()` renderer

Use this function wherever Portable Text needs to be rendered as HTML.
Apply with `v-html="blocksToHtml(blocks)"` in Vue templates.

```typescript
interface SanitySpan {
  _key: string
  _type: string
  text: string
  marks?: string[]
}

interface SanityMarkDef {
  _key: string
  _type: string
  href?: string
}

interface SanityBlock {
  _key: string
  _type: string
  style?: string
  children?: SanitySpan[]
  markDefs?: SanityMarkDef[]
}

export function blocksToHtml(blocks?: SanityBlock[] | null): string {
  if (!Array.isArray(blocks) || blocks.length === 0) return ''

  return blocks.map(block => {
    if (block._type !== 'block') return ''

    // Build mark key → href lookup for this block
    const linkMap: Record<string, string> = {}
    block.markDefs?.forEach(def => {
      if (def._type === 'link' && def.href) {
        linkMap[def._key] = def.href
      }
    })

    const inner = (block.children ?? []).map(child => {
      let t = child.text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')

      // Inline marks
      if (child.marks?.includes('strong'))    t = `<strong>${t}</strong>`
      if (child.marks?.includes('em'))        t = `<em>${t}</em>`
      if (child.marks?.includes('underline')) t = `<u>${t}</u>`
      if (child.marks?.includes('code'))      t = `<code>${t}</code>`

      // Link mark — find a mark key that matches a markDef
      const linkKey = child.marks?.find(m => linkMap[m])
      if (linkKey) {
        const href = linkMap[linkKey]
        const isInternal = href.startsWith('/')
        if (isInternal) {
          t = `<a href="${href}" class="internal-link">${t}</a>`
        } else {
          t = `<a href="${href}" target="_blank" rel="noopener noreferrer" class="external-link">${t}</a>`
        }
      }

      return t
    }).join('')

    // Block style
    switch (block.style) {
      case 'h1': return `<h1>${inner}</h1>`
      case 'h2': return `<h2>${inner}</h2>`
      case 'h3': return `<h3>${inner}</h3>`
      case 'blockquote': return `<blockquote>${inner}</blockquote>`
      case 'preformatted': return `<pre class="pre-table">${inner}</pre>` // consecutive blocks share one <pre>
      default:   return `<p>${inner}</p>`
    }
  }).join('\n')
}
```

---

## The `blocksToText()` function

Use this for IndexedDB storage and search — strips all marks and returns
plain text. Used during the cache index phase, NOT for rendering.

```typescript
export function blocksToText(blocks?: SanityBlock[] | null): string {
  if (!Array.isArray(blocks) || blocks.length === 0) return ''
  return blocks
    .map(block => block.children?.map(c => c.text ?? '').join('') ?? '')
    .join('\n')
    .trim()
}
```

---

## Internal link navigation

`blocksToHtml()` outputs `<a href="/events/..." class="internal-link">`.
Since the app uses Vue Router, clicking these anchors must use `router.push()`
instead of browser navigation.

Intercept clicks on `.internal-link` in the component that renders the HTML:

```vue
<div
  class="portable-text"
  v-html="blocksToHtml(blocks)"
  @click.prevent="handleInternalLinks"
/>
```

```typescript
import { useRouter } from 'vue-router'

const router = useRouter()

function handleInternalLinks(e: MouseEvent) {
  const target = e.target as HTMLElement
  const link = target.closest('a.internal-link') as HTMLAnchorElement | null
  if (link) {
    e.preventDefault()
    router.push(link.getAttribute('href') ?? '/')
  }
}
```

---

## CSS for portable text

```css
.portable-text p {
  margin: 0 0 0.75em;
  line-height: 1.7;
  font-size: 13px;
  color: #3a3020;
}

.portable-text p:last-child {
  margin-bottom: 0;
}

.portable-text strong {
  font-weight: 500;
  color: #1a1008;
}

.portable-text u {
  text-decoration: underline;
}

.portable-text a.internal-link,
.portable-text a.external-link {
  color: #276a8b;
  text-decoration: underline;
  cursor: pointer;
}

.portable-text a.external-link::after {
  content: ' ↗';
  font-size: 11px;
  opacity: 0.6;
}

.portable-text blockquote {
  border-left: 3px solid #d4c9b0;
  padding-left: 12px;
  color: #8a7a60;
  font-style: italic;
  margin: 0.5em 0;
}

.portable-text code {
  font-family: monospace;
  font-size: 12px;
  background: #f0ebe0;
  padding: 1px 4px;
  border-radius: 3px;
}
```

---

## Where Portable Text is used in this app

| Location | Function | Notes |
|---|---|---|
| Hjem card descriptions | `blocksToHtml()` + `v-html` | Needs link interception |
| Event detail description | `blocksToHtml()` + `v-html` | Can be 20+ blocks (SABOR) |
| Location description | `blocksToText()` at index time | Stored as plain string in IndexedDB |
| Person description | `blocksToText()` at index time | Stored as plain string in IndexedDB |
| Station description | `blocksToText()` at index time | Stored as plain string in IndexedDB |
| Event description | NOT cached — fetched on demand | Too large for IndexedDB |
| About page | `blocksToHtml()` + `v-html` | Same marks expected |

---

## Important: never use `blocksToText()` for rendering

`blocksToText()` strips all marks — bold, links, underline all lost.
Use it only for search indexing and plain-text storage.
Use `blocksToHtml()` for anything the user sees.

## Tables: the `preformatted` style (#260)

A table, a roster or any text that must keep its spacing is a block with the style `preformatted`. The
editor has a button for it (the table icon, next to the quote), and `blocksToHtml` draws consecutive
`preformatted` blocks as one `<pre class="pre-table">`. Nothing is guessed: a tab in an ordinary paragraph
is just a tab. Before #260 the renderer called any tab-bearing block without prose a table (`isTableBlock`,
#256); `scripts/migrations/preformatted-table-blocks.ts` set the style on those blocks once (production,
2026-10-14), the renderer's guess is gone, and `scripts/lib/preformatted-blocks.ts` keeps the old rule, frozen,
for the migration and for the sync.

### Containers: a box and a table (#308, #313)

A block has one `style`, so a box and a table cannot be styles that combine. They are **containers**, blocks that
hold blocks, and `blocksToHtml` and `blocksToText` read the tree:

```
{ _type: 'infoBox', content: [ …blocks, tables… ] }
{ _type: 'table', frame?, rowLines?, columnLines?, rows: [ { _type: 'row', cells: [ { _type: 'cell', content: [ …blocks… ] } ] } ] }
```

- A **box** is `<div class="pt-box">` around what it holds; it may hold a table.
- A **table** is `<div class="pt-table-wrap"><table class="pt-table">`; a cell is drawn as the blocks it holds (paragraphs, lists,
  marks, links), a short row is padded so the columns line up, and the table scrolls sideways as one unit.
- The options of a table are fields on it, drawn as classes: `frame` (`topBottom` or `around`, else none) →
  `pt-table--topbottom` / `pt-table--around`; `rowLines: true` → `pt-table--rows`; `columnLines: true` → `pt-table--columns`.
- A container the reader does not know, and a `row` or `cell` on its own, is drawn as what it holds: text is never dropped.
- `blocksToText` reads a table as rows on lines with a tab between cells (a cell's blocks on one line), a box one block to a
  line, and an unknown container as its contents.
- The checks of a description (headings, links, lists) read inside containers through one walk, `src/utils/blockTree.ts` (#314).
  A heading in a box counts in the section's outline; a table cell holds none (reported as `in-cell`).
- **Bundles** treat a top-level container as one block (#315): `modify-block` replaces it whole, hashed whole for `expectedSha`,
  and ingest checks the tree (`functions/_lib/description-blocks.ts`). `docs/BUNDLE-FORMAT.md`, *Containers*.
- The editor (#312) learns to make them; until then a description with a container is only ever made by hand.

Sanity has no such style, so everything that takes a description in from Sanity runs it through
`preformattedFromSanity` (the description sync, the event and person rules, the importers). The graph and
"Sanity as imported" stay the same text, and a migrated description is not read as an edit to rewrite.
