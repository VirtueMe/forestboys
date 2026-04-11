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

function renderSpans(children: SanitySpan[], linkMap: Record<string, string>): string {
  return (children ?? []).map(child => {
    let t = (child.text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>')

    if (child.marks?.includes('strong'))    t = `<strong>${t}</strong>`
    if (child.marks?.includes('em'))        t = `<em>${t}</em>`
    if (child.marks?.includes('underline')) t = `<u>${t}</u>`
    if (child.marks?.includes('code'))      t = `<code>${t}</code>`

    const linkKey = child.marks?.find(m => linkMap[m])
    if (linkKey) {
      const href = linkMap[linkKey]
      if (href.startsWith('/')) {
        t = `<a href="${href}" class="internal-link">${t}</a>`
      } else if (href.startsWith('http')) {
        t = `<a href="${href}" target="_blank" rel="noopener noreferrer" class="external-link">${t}</a>`
      } else {
        t = `<a href="/events/${href}" class="internal-link">${t}</a>`
      }
    }

    return t
  }).join('')
}

export function blocksToHtml(blocks?: SanityBlock[] | unknown | null): string {
  if (!Array.isArray(blocks) || blocks.length === 0) return ''

  const parts: string[] = []
  let listStack: { tag: string; level: number }[] = []

  function closeLists(toLevel = 0) {
    while (listStack.length > 0 && listStack[listStack.length - 1].level >= toLevel) {
      parts.push(`</${listStack.pop()!.tag}>`)
    }
  }

  for (const block of blocks as SanityBlock[]) {
    if (block._type !== 'block') continue

    const linkMap: Record<string, string> = {}
    block.markDefs?.forEach(def => {
      if (def._type === 'link' && def.href) linkMap[def._key] = def.href
    })

    const inner = renderSpans(block.children ?? [], linkMap)

    if (block.listItem) {
      const tag  = block.listItem === 'number' ? 'ol' : 'ul'
      const level = block.level ?? 1

      // close deeper lists
      closeLists(level + 1)

      // open a new list at this level if needed
      if (listStack.length === 0 || listStack[listStack.length - 1].level < level) {
        parts.push(`<${tag}>`)
        listStack.push({ tag, level })
      }

      parts.push(`<li>${inner}</li>`)
    } else {
      closeLists()
      switch (block.style) {
        case 'h1':         parts.push(`<h1>${inner}</h1>`); break
        case 'h2':         parts.push(`<h2>${inner}</h2>`); break
        case 'h3':         parts.push(`<h3>${inner}</h3>`); break
        case 'h4':         parts.push(`<h4>${inner}</h4>`); break
        case 'h5':         parts.push(`<h5>${inner}</h5>`); break
        case 'blockquote': parts.push(`<blockquote>${inner}</blockquote>`); break
        default:           if (inner) parts.push(`<p>${inner}</p>`)
      }
    }
  }

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
