/**
 * The browser half of the design checks (#139): walk a page and hand over what it renders, as plain data
 * for the pure judges (src/utils/contrast.ts, src/utils/pageOutline.ts). The functions passed to
 * `page.evaluate` run in the page, so each is self-contained: it uses nothing from this file.
 */
import type { Page } from '@playwright/test'
import type { TextSample } from '../../src/utils/contrast.ts'
import type { HeadingSample } from '../../src/utils/pageOutline.ts'

/**
 * Things that are in the page in development and are not the app: the Vue devtools button and the
 * inspector, and Vite's error overlay. They are not judged.
 */
const TOOLING = '[id*="vue-devtools"], [class*="vue-devtools"], [data-v-inspector], vite-error-overlay'

/**
 * Every piece of visible text on the page (or under `scope`), with the colours it is drawn in.
 *
 * Judged by the DOM: a text's background is the first opaque `background-color` among its ancestors,
 * with the translucent ones in between laid on top. That is wrong for text positioned over something that
 * is not its ancestor (a label over a map, say), which is a known limit and not hidden: text over an image
 * or gradient is reported as not judged, and the rest is as good as the markup is.
 *
 * Skipped, because the standard does not ask for contrast there: text that is not visible (display,
 * visibility, opacity 0, zero size), disabled controls, script/style/svg/canvas, and the dev tooling.
 * Placeholders are included: they are text a person has to read.
 */
export function collectTextSamples(page: Page, scope = 'body'): Promise<TextSample[]> {
  return page.evaluate(({ scopeSelector, tooling }) => {
    const root = document.querySelector(scopeSelector) ?? document.body
    const samples: TextSample[] = []

    const where = (el: Element) => {
      const parts: string[] = []
      for (let e: Element | null = el, i = 0; e && e !== document.body && i < 3; e = e.parentElement, i++) {
        const cls = (e.getAttribute('class') ?? '').split(/\s+/).find(c => c && !c.startsWith('data-v'))
        parts.unshift(e.tagName.toLowerCase() + (cls ? '.' + cls : ''))
      }
      return parts.join(' > ') || 'body'
    }
    const alphaOf = (css: string) => {
      const m = /^rgba?\(([^)]*)\)$/.exec(css.trim())
      if (!m) return css === 'transparent' ? 0 : 1
      const parts = m[1].split(/[\s,/]+/).filter(Boolean)
      return parts.length > 3 ? Number(parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parts[3]) : 1
    }
    /** The layers behind an element, nearest first, up to the first opaque one; null when an image is in the way. */
    const backgroundsOf = (el: Element): string[] | null => {
      const layers: string[] = []
      for (let e: Element | null = el; e; e = e.parentElement) {
        const cs = getComputedStyle(e)
        if (cs.backgroundImage !== 'none') return null
        const a = alphaOf(cs.backgroundColor)
        if (a > 0) layers.push(cs.backgroundColor)
        if (a >= 1) break
      }
      return layers
    }
    const opacityOf = (el: Element) => {
      let o = 1
      for (let e: Element | null = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity)
      return o
    }
    const judgeable = (el: Element) =>
      !el.closest(`script, style, noscript, svg, canvas, template, ${tooling}`) &&
      !el.closest(':disabled, [aria-disabled="true"]') &&
      el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })

    const add = (el: Element, text: string, color: string) => {
      const cs = getComputedStyle(el)
      samples.push({
        text: text.length > 40 ? text.slice(0, 40) + '…' : text,
        where: where(el),
        color,
        opacity: opacityOf(el),
        backgrounds: backgroundsOf(el),
        fontSize: parseFloat(cs.fontSize),
        fontWeight: Number(cs.fontWeight),
      })
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
      const el = node.parentElement
      if (!text || !el || !judgeable(el)) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      const box = range.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) continue
      add(el, text, getComputedStyle(el).color)
    }

    for (const input of root.querySelectorAll('input[placeholder], textarea[placeholder]')) {
      const field = input as HTMLInputElement
      if (field.value || !judgeable(field)) continue
      add(field, field.placeholder, getComputedStyle(field, '::placeholder').color)
    }
    return samples
  }, { scopeSelector: scope, tooling: TOOLING })
}

/**
 * The visible headings of the page, in document order: h1 to h6 and elements with role=heading and an
 * aria-level. Headings that are hidden, or inside aria-hidden content, are not in the outline a person
 * using a screen reader gets, so they are not here either.
 */
export function collectHeadings(page: Page): Promise<HeadingSample[]> {
  return page.evaluate((tooling) => {
    const out: HeadingSample[] = []
    const where = (el: Element) => {
      const parts: string[] = []
      for (let e: Element | null = el, i = 0; e && e !== document.body && i < 3; e = e.parentElement, i++) {
        const cls = (e.getAttribute('class') ?? '').split(/\s+/).find(c => c && !c.startsWith('data-v'))
        parts.unshift(e.tagName.toLowerCase() + (cls ? '.' + cls : ''))
      }
      return parts.join(' > ') || 'body'
    }
    for (const el of document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')) {
      if (el.closest(`[aria-hidden="true"], template, ${tooling}`)) continue
      if (!el.checkVisibility({ checkVisibilityCSS: true })) continue
      const level = /^H[1-6]$/.test(el.tagName) ? Number(el.tagName[1]) : Number(el.getAttribute('aria-level') ?? 2)
      out.push({ level, text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(), where: where(el) })
    }
    return out
  }, TOOLING)
}
