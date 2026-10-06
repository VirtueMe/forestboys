/**
 * WCAG 2.x contrast for what a page really renders (#139): the pure half. The browser half
 * (e2e/helpers/contrast.ts) walks the page and hands over what it saw, as `TextSample`s; this decides
 * whether each one is readable.
 *
 * It judges what the page shows, not what a design document declares. The declared pairs of DESIGN.md
 * are checked by `npm run check:design` (#134); this finds a token used where nobody declared the pair.
 */

export interface Rgba { r: number; g: number; b: number; a: number }

/** Parse a computed CSS colour: `rgb()`/`rgba()` in comma or space syntax, and `color(srgb …)`. Else null. */
export function parseCssColor(css: string): Rgba | null {
  const s = css.trim().toLowerCase()
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(s)
  if (rgb) return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: alpha(rgb[4]) }
  const srgb = /^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(s)
  if (srgb) return { r: Number(srgb[1]) * 255, g: Number(srgb[2]) * 255, b: Number(srgb[3]) * 255, a: alpha(srgb[4]) }
  return null
}

function alpha(raw: string | undefined): number {
  if (raw === undefined) return 1
  return raw.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : Number(raw)
}

/** `top` laid over an opaque `under`: the colour that reaches the eye. */
export function over(top: Rgba, under: Rgba): Rgba {
  const a = top.a
  return {
    r: top.r * a + under.r * (1 - a),
    g: top.g * a + under.g * (1 - a),
    b: top.b * a + under.b * (1 - a),
    a: 1,
  }
}

/** Relative luminance, WCAG 2.x (sRGB). */
export function luminance({ r, g, b }: Pick<Rgba, 'r' | 'g' | 'b'>): number {
  const lin = (c: number) => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** Contrast ratio of two opaque colours, 1 to 21. */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** WCAG's «large text»: at least 24px, or at least 18.66px (14pt) and bold. */
export const isLargeText = (fontSizePx: number, fontWeight: number) =>
  fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700)

/** What the page showed for one piece of text, as the browser reported it. */
export interface TextSample {
  /** The first words of it, to find it by. */
  text: string
  /** A short path to its element: `section.section > h2.section-heading`. */
  where: string
  /** Computed `color` of the text, and the element's own and ancestors' opacity multiplied together. */
  color: string
  opacity: number
  /**
   * The background layers from the element up to the first opaque one, as computed `background-color`
   * strings, nearest first. Null when something the colours cannot describe is behind the text: an
   * image or a gradient. Such a sample is reported as not judged, never as passing.
   */
  backgrounds: string[] | null
  fontSize: number
  fontWeight: number
}

export interface Violation {
  /** Which samples share this: same colours and size. */
  ratio: number
  required: number
  fg: string
  bg: string
  fontSize: number
  fontWeight: number
  large: boolean
  count: number
  /** A few places to look: «text» at `where`. */
  examples: string[]
}

export interface Judged {
  violations: Violation[]
  /** Samples that could not be judged, and why. Not failures, but never silently dropped. */
  notJudged: { reason: string; count: number; examples: string[] }[]
  /** How many samples were judged and passed. */
  passed: number
}

const hex = (c: Rgba) => '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()

/**
 * The page canvas under everything: the browser's default is white, and a page that sets none (a
 * harness, a bare document) is white too. The real pages set their own on `body`, which the browser
 * half reports as a layer like any other.
 */
const CANVAS: Rgba = { r: 255, g: 255, b: 255, a: 1 }

/** Resolve a sample's background to one opaque colour, or say why not. */
function background(sample: TextSample): { bg: Rgba } | { reason: string } {
  if (sample.backgrounds === null) return { reason: 'text over an image or a gradient' }
  let bg = CANVAS
  // nearest first: lay the farthest down first
  for (const layer of [...sample.backgrounds].reverse()) {
    const c = parseCssColor(layer)
    if (!c) return { reason: `a background colour that could not be read: ${layer}` }
    bg = over(c, bg)
  }
  return { bg }
}

/** Judge every sample against WCAG AA for text: 4.5:1, or 3:1 for large text. Groups what is alike. */
export function judgeText(samples: TextSample[]): Judged {
  const groups = new Map<string, Violation>()
  const skipped = new Map<string, { reason: string; count: number; examples: string[] }>()
  let passed = 0

  const skip = (reason: string, s: TextSample) => {
    const g = skipped.get(reason) ?? { reason, count: 0, examples: [] }
    g.count++
    if (g.examples.length < 3) g.examples.push(`«${s.text}» at ${s.where}`)
    skipped.set(reason, g)
  }

  for (const s of samples) {
    const bgResult = background(s)
    if ('reason' in bgResult) { skip(bgResult.reason, s); continue }
    const fgRaw = parseCssColor(s.color)
    if (!fgRaw) { skip(`a text colour that could not be read: ${s.color}`, s); continue }

    // The element's opacity thins the text as much as its colour's own alpha does.
    const fg = over({ ...fgRaw, a: fgRaw.a * s.opacity }, bgResult.bg)
    const ratio = contrastRatio(fg, bgResult.bg)
    const large = isLargeText(s.fontSize, s.fontWeight)
    const required = large ? 3 : 4.5
    if (ratio >= required) { passed++; continue }

    const key = [hex(fg), hex(bgResult.bg), s.fontSize, s.fontWeight].join('|')
    const g = groups.get(key) ?? {
      ratio: Math.round(ratio * 100) / 100, required, fg: hex(fg), bg: hex(bgResult.bg),
      fontSize: s.fontSize, fontWeight: s.fontWeight, large, count: 0, examples: [],
    }
    g.count++
    if (g.examples.length < 3) g.examples.push(`«${s.text}» at ${s.where}`)
    groups.set(key, g)
  }

  return {
    violations: [...groups.values()].sort((a, b) => b.count - a.count),
    notJudged: [...skipped.values()],
    passed,
  }
}
