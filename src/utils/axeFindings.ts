/**
 * What to do with what axe-core found (#139): the pure half of the semantics check. axe-core knows the
 * rules (landmarks, names, alt text, language, target size, ...); this decides which findings fail a test.
 *
 * The one thing axe cannot know is what we have decided about a finding, so a decision is written down as
 * an `AxeException`: for named page kinds, a rule, and the elements it is about, with the issue that holds
 * the decision. An exception **expires by itself**: if it matched nothing on a page it names, that is a
 * problem too, so a fixed finding cannot leave its exception behind.
 */

/** The part of an axe violation this needs. */
export interface AxeViolation {
  id: string
  impact?: string | null
  help: string
  nodes: { target: unknown[] }[]
}

export interface AxeException {
  rule: string
  /** The page kinds (e2e/pages.ts) it applies to. */
  pages: string[]
  /** The elements it is about: a node is excepted when its selector starts with one of these. */
  selectors: string[]
  /** The issue that holds the decision. */
  issue: string
  reason: string
}

export interface AxeJudged {
  /** What fails the test: findings nobody has decided about, and exceptions that no longer match. */
  problems: string[]
  /** What was excepted, and why, for the report. */
  excepted: string[]
}

const selectorOf = (node: { target: unknown[] }) => node.target.flat(Infinity).join(' ')

export function judgeAxe(page: string, violations: AxeViolation[], exceptions: AxeException[]): AxeJudged {
  const problems: string[] = []
  const excepted: string[] = []
  const mine = exceptions.filter(e => e.pages.includes(page))
  const used = new Set<AxeException>()

  for (const v of violations) {
    const open: string[] = []
    for (const node of v.nodes) {
      const selector = selectorOf(node)
      const exception = mine.find(e => e.rule === v.id && e.selectors.some(s => selector.startsWith(s)))
      if (exception) { used.add(exception); excepted.push(`${v.id} at ${selector}: ${exception.issue}, ${exception.reason}`) }
      else open.push(selector)
    }
    if (open.length) {
      problems.push(`[${v.impact ?? 'unknown'}] ${v.id}: ${v.help}; ${open.length} element${open.length === 1 ? '' : 's'}, for example ${open.slice(0, 2).join(' ; ')}`)
    }
  }

  for (const e of mine) {
    if (!used.has(e)) problems.push(`the exception for ${e.rule} (${e.issue}) matched nothing on «${page}»: the finding is gone, so delete the exception`)
  }
  return { problems, excepted }
}
