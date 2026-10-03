/**
 * CHANGELOG.md as release-please writes it, parsed into data so it can be
 * rendered with templates (no HTML from markdown, no v-html).
 *
 *   ## [0.1.1](compare-url) (2026-10-03)      or   ## 0.1.0 (2026-10-03)
 *   ### Bug fixes
 *   * **auth:** show why a sign-in failed ([226b216](commit-url)), closes [#14](issue-url)
 */

export interface Segment { text: string; bold?: boolean; href?: string }
export interface Section { title: string; items: Segment[][] }
export interface Release { version: string; date: string; sections: Section[] }

const RELEASE_RE = /^## \[?([^\]\s]+)\]?(?:\([^)]*\))? \((\d{4}-\d{2}-\d{2})\)\s*$/
const INLINE_RE  = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g

/** Bold and links; anything else stays plain text. Only http(s) links are kept as links. */
export function parseInline(line: string): Segment[] {
  const out: Segment[] = []
  let last = 0
  for (const m of line.matchAll(INLINE_RE)) {
    if (m.index > last) out.push({ text: line.slice(last, m.index) })
    if (m[1] !== undefined) {
      out.push({ text: m[1], bold: true })
    } else if (/^https?:\/\//.test(m[3])) {
      out.push({ text: m[2], href: m[3] })
    } else {
      out.push({ text: m[2] })
    }
    last = m.index + m[0].length
  }
  if (last < line.length) out.push({ text: line.slice(last) })
  return out
}

export function parseChangelog(markdown: string): Release[] {
  const releases: Release[] = []
  let release: Release | null = null
  let section: Section | null = null

  for (const raw of markdown.split('\n')) {
    const line = raw.trimEnd()
    const head = RELEASE_RE.exec(line)
    if (head) {
      release = { version: head[1], date: head[2], sections: [] }
      releases.push(release)
      section = null
    } else if (release && line.startsWith('### ')) {
      section = { title: line.slice(4).trim(), items: [] }
      release.sections.push(section)
    } else if (section && /^[*-] /.test(line)) {
      section.items.push(parseInline(line.slice(2)))
    }
  }
  return releases
}
