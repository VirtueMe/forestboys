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
  children?: SanitySpan[]
  markDefs?: SanityMarkDef[]
}

export function blocksToHtml(blocks?: SanityBlock[] | unknown | null): string {
  if (!Array.isArray(blocks) || blocks.length === 0) return ''

  return (blocks as SanityBlock[]).map(block => {
    if (block._type !== 'block') return ''

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
          // bare event slug → /events/:slug
          t = `<a href="/events/${href}" class="internal-link">${t}</a>`
        }
      }

      return t
    }).join('')

    switch (block.style) {
      case 'h1':         return `<h1>${inner}</h1>`
      case 'h2':         return `<h2>${inner}</h2>`
      case 'h3':         return `<h3>${inner}</h3>`
      case 'blockquote': return `<blockquote>${inner}</blockquote>`
      default:           return inner ? `<p>${inner}</p>` : ''
    }
  }).filter(Boolean).join('\n')
}

export function blocksToText(blocks?: SanityBlock[] | unknown | null): string {
  if (!Array.isArray(blocks) || blocks.length === 0) return ''
  return (blocks as SanityBlock[])
    .map(block => block.children?.map(c => c.text ?? '').join('') ?? '')
    .join('\n')
    .trim()
}
