import { describe, expect, it } from 'vitest'
import { judgeAxe, type AxeException, type AxeViolation } from './axeFindings.ts'

const violation = (id: string, ...targets: string[]): AxeViolation => ({
  id, impact: 'serious', help: `help for ${id}`, nodes: targets.map(t => ({ target: [t] })),
})
const exception = (over: Partial<AxeException> = {}): AxeException => ({
  rule: 'target-size', pages: ['events'], selectors: ['.tl-dot', '.tl-bubble'], issue: '#142', reason: 'the list does the same job', ...over,
})

describe('judgeAxe', () => {
  it('has nothing to say about a page with no findings and no exceptions', () => {
    expect(judgeAxe('person', [], [])).toEqual({ problems: [], excepted: [] })
  })

  it('fails a finding nobody has decided about, with its impact, rule, and where', () => {
    const r = judgeAxe('person', [violation('select-name', 'select.filter-select')], [])
    expect(r.problems).toEqual(['[serious] select-name: help for select-name; 1 element, for example select.filter-select'])
  })

  it('excepts the elements an exception names, and lists them with the issue and the reason', () => {
    const r = judgeAxe('events', [violation('target-size', '.tl-dot', '.tl-bubble[type="button"]:nth-child(29)')], [exception()])
    expect(r.problems).toEqual([])
    expect(r.excepted).toEqual([
      'target-size at .tl-dot: #142, the list does the same job',
      'target-size at .tl-bubble[type="button"]:nth-child(29): #142, the list does the same job',
    ])
  })

  it('fails what an exception does not cover: another element with the same rule, or another rule', () => {
    const r = judgeAxe('events', [violation('target-size', '.tl-dot', '.other-button'), violation('select-name', '.tl-dot')], [exception()])
    expect(r.problems).toEqual([
      '[serious] target-size: help for target-size; 1 element, for example .other-button',
      '[serious] select-name: help for select-name; 1 element, for example .tl-dot',
    ])
  })

  it('does not apply an exception to a page it does not name', () => {
    const r = judgeAxe('person', [violation('target-size', '.tl-dot')], [exception()])
    expect(r.problems).toHaveLength(1)
    expect(r.excepted).toEqual([])
  })

  it('expires by itself: an exception that matched nothing on its page is a problem', () => {
    const r = judgeAxe('events', [], [exception()])
    expect(r.problems).toEqual(['the exception for target-size (#142) matched nothing on «events»: the finding is gone, so delete the exception'])
  })

  it('does not call an exception for another page expired', () => {
    expect(judgeAxe('person', [], [exception()]).problems).toEqual([])
  })

  it('joins the selector of a node inside a shadow root or a frame', () => {
    const v: AxeViolation = { id: 'x', help: 'h', nodes: [{ target: [['my-element', '.inner']] }] }
    expect(judgeAxe('person', [v], []).problems[0]).toContain('my-element .inner')
    expect(judgeAxe('person', [v], []).problems[0]).toContain('[unknown]')   // no impact given
  })
})
