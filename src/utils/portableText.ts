export interface SanitySpan {
  _key: string
  _type: string
  text: string
  marks?: string[]
}

export interface SanityMarkDef {
  _key: string
  _type: string
  href?: string
  slug?: string
  name?: string
}

export interface SanityBlock {
  _key: string
  _type: string
  style?: string
  listItem?: 'bullet' | 'number'
  level?: number
  children?: SanitySpan[]
  markDefs?: SanityMarkDef[]
}

// A stored link target is whatever someone typed in Sanity: a bare slug, a path, a URL, and
// often with a stray space or a ../ in front. These are the kinds of page a path can name.
const KIND_ROUTES: Record<string, string> = {
  events: '/events', event: '/events',
  people: '/person', person: '/person',
  locations: '/map', location: '/map',
  outlines: '/outlines', outline: '/outlines',
  stations: '/station', station: '/station',
  transport: '/transport',
  organizations: '/organization', organization: '/organization',
  equipment: '/equipment',
}

export type LinkTarget =
  | { kind: 'internal'; href: string }
  | { kind: 'external'; href: string }
  | { kind: 'mail'; href: string }

/** A path segment that may hold a space or a slash (one event slug has both). */
const encodeSlug = (slug: string) => encodeURIComponent(slug)

/**
 * Where a stored link target should lead, or null when it names nothing.
 * - `/x/y`                    → as it is
 * - `https://…`               → external; a URL buried in other text is found
 * - `mailto:`, `tel:`         → a plain link
 * - `../people/x`, `./x/y`    → the page of that kind (`/person/x`)
 * - anything else             → a bare slug, taken to be an event
 * Surrounding spaces are ignored. A bare slug that turns out not to be an event
 * is sorted out when the page opens (see slugResolver.ts).
 */
export function resolveLinkTarget(raw: string | undefined): LinkTarget | null {
  const t = (raw ?? '').trim()
  if (!t) return null
  if (/^(mailto|tel):/i.test(t)) return { kind: 'mail', href: t }
  if (/^https?:\/\//i.test(t)) return { kind: 'external', href: t }
  const buried = t.match(/https?:\/\/[^\s)"']+/i)
  if (buried) return { kind: 'external', href: buried[0].replace(/[.,;]+$/, '') }
  if (t.startsWith('/')) return { kind: 'internal', href: t }
  const rel = t.match(/^(?:\.{1,2}\/)+([A-Za-z-]+)\/(.+)$/)
  if (rel) {
    const route = KIND_ROUTES[rel[1].toLowerCase()]
    if (route) return { kind: 'internal', href: `${route}/${encodeSlug(rel[2].trim())}` }
    return { kind: 'internal', href: `/events/${encodeSlug(rel[2].trim())}` }
  }
  return { kind: 'internal', href: `/events/${encodeSlug(t)}` }
}

/** Does any span in `blocks` carry a link mark? A def that no span uses does not count. */
export function hasLinkMark(blocks: unknown[]): boolean {
  return blocks.some(b => {
    const block = b as SanityBlock
    if (block?._type !== 'block') return false
    const links = new Set((block.markDefs ?? []).filter(d => d._type === 'link').map(d => d._key))
    return (block.children ?? []).some(c => (c.marks ?? []).some(m => links.has(m)))
  })
}

const attr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function renderSpans(
  children:  SanitySpan[],
  linkMap:   Record<string, string>,
  personMap: Record<string, { slug: string; name?: string }>,
): string {
  return (children ?? []).map(child => {
    let t = (child.text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>')

    if (child.marks?.includes('strong'))         t = `<strong>${t}</strong>`
    if (child.marks?.includes('em'))             t = `<em>${t}</em>`
    if (child.marks?.includes('underline'))      t = `<u>${t}</u>`
    if (child.marks?.includes('strike-through')) t = `<s>${t}</s>`
    if (child.marks?.includes('code'))           t = `<code>${t}</code>`

    const personKey = child.marks?.find(m => personMap[m])
    if (personKey) {
      const p = personMap[personKey]
      t = `<a href="/person/${p.slug}" class="internal-link person-link">${t}</a>`
    } else {
      const linkKey = child.marks?.find(m => linkMap[m])
      if (linkKey) {
        const target = resolveLinkTarget(linkMap[linkKey])
        if (target?.kind === 'internal') {
          t = `<a href="${attr(target.href)}" class="internal-link">${t}</a>`
        } else if (target?.kind === 'external') {
          t = `<a href="${attr(target.href)}" target="_blank" rel="noopener noreferrer" class="external-link">${t}</a>`
        } else if (target?.kind === 'mail') {
          t = `<a href="${attr(target.href)}" class="external-link">${t}</a>`
        }
      }
    }

    return t
  }).join('')
}

export function blocksToHtml(blocks?: SanityBlock[] | unknown | null): string {
  if (!Array.isArray(blocks) || blocks.length === 0) return ''

  const parts: string[] = []
  const listStack: { tag: string; level: number }[] = []
  const preBuffer: string[] = []  // accumulate consecutive tab-bearing blocks

  function flushPre() {
    if (preBuffer.length > 0) {
      parts.push(`<pre class="pre-table">${preBuffer.join('\n')}</pre>`)
      preBuffer.length = 0
    }
  }

  function closeLists(toLevel = 0) {
    while (listStack.length > 0 && listStack[listStack.length - 1].level >= toLevel) {
      parts.push(`</${listStack.pop()!.tag}>`)
    }
  }

  for (const block of blocks as SanityBlock[]) {
    if (block._type !== 'block') continue

    const linkMap:   Record<string, string> = {}
    const personMap: Record<string, { slug: string; name?: string }> = {}
    block.markDefs?.forEach(def => {
      if (def._type === 'link' && def.href) linkMap[def._key] = def.href
      if (def._type === 'person' && def.slug) personMap[def._key] = { slug: def.slug, name: def.name }
    })

    const inner = renderSpans(block.children ?? [], linkMap, personMap)

    if (block.listItem) {
      flushPre()
      const tag  = block.listItem === 'number' ? 'ol' : 'ul'
      const level = block.level ?? 1
      closeLists(level + 1)
      if (listStack.length === 0 || listStack[listStack.length - 1].level < level) {
        parts.push(`<${tag}>`)
        listStack.push({ tag, level })
      }
      parts.push(`<li>${inner}</li>`)
    } else {
      closeLists()
      switch (block.style) {
        case 'h1':         flushPre(); parts.push(`<h1>${inner}</h1>`); break
        case 'h2':         flushPre(); parts.push(`<h2>${inner}</h2>`); break
        case 'h3':         flushPre(); parts.push(`<h3>${inner}</h3>`); break
        case 'h4':         flushPre(); parts.push(`<h4>${inner}</h4>`); break
        case 'h5':         flushPre(); parts.push(`<h5>${inner}</h5>`); break
        case 'blockquote': flushPre(); parts.push(`<blockquote>${inner}</blockquote>`); break
        default:
          if (inner && inner.includes('\t')) {
            // Tab-bearing blocks are roster/table rows — buffer and merge into one <pre>
            preBuffer.push(inner)
          } else {
            flushPre()
            if (inner) parts.push(`<p>${inner}</p>`)
          }
      }
    }
  }

  flushPre()
  closeLists()
  return parts.join('\n')
}

export function blocksToText(blocks?: SanityBlock[] | unknown | null): string {
  if (!Array.isArray(blocks) || blocks.length === 0) return ''
  return (blocks as SanityBlock[])
    .map(block => block.children?.map(c => c.text ?? '').join('') ?? '')
    .join('\n')
    .trim()
}
