import { describe, expect, it } from 'vitest'
import { blocksToHtml, blocksToText, type SanityBlock } from './portableText'

const block = (over: Partial<SanityBlock> & { text?: string; marks?: string[] }): SanityBlock => ({
  _key: 'b',
  _type: 'block',
  children: [{ _key: 's', _type: 'span', text: over.text ?? '', marks: over.marks }],
  ...over,
})

describe('blocksToHtml', () => {
  it('returns an empty string for missing or empty input', () => {
    expect(blocksToHtml(undefined)).toBe('')
    expect(blocksToHtml(null)).toBe('')
    expect(blocksToHtml([])).toBe('')
    expect(blocksToHtml('not an array')).toBe('')
  })

  it('wraps normal text in <p> and skips empty paragraphs', () => {
    expect(blocksToHtml([block({ text: 'Hei' }), block({ text: '' })])).toBe('<p>Hei</p>')
  })

  it('escapes HTML and turns newlines into <br>', () => {
    expect(blocksToHtml([block({ text: '<b>&\nx' })])).toBe('<p>&lt;b&gt;&amp;<br>x</p>')
  })

  it('renders headings and blockquotes', () => {
    expect(blocksToHtml([block({ text: 'T', style: 'h2' })])).toBe('<h2>T</h2>')
    expect(blocksToHtml([block({ text: 'Q', style: 'blockquote' })])).toBe('<blockquote>Q</blockquote>')
  })

  it('applies marks', () => {
    expect(blocksToHtml([block({ text: 'x', marks: ['strong', 'em'] })])).toBe('<p><em><strong>x</strong></em></p>')
  })

  it('links internal, external and event-slug hrefs differently', () => {
    const link = (href: string) => blocksToHtml([{
      _key: 'b', _type: 'block',
      markDefs: [{ _key: 'l', _type: 'link', href }],
      children: [{ _key: 's', _type: 'span', text: 'x', marks: ['l'] }],
    }])
    expect(link('/locations/oslo')).toBe('<p><a href="/locations/oslo" class="internal-link">x</a></p>')
    expect(link('https://nb.no/x')).toBe('<p><a href="https://nb.no/x" target="_blank" rel="noopener noreferrer" class="external-link">x</a></p>')
    expect(link('operasjon-freshman')).toBe('<p><a href="/events/operasjon-freshman" class="internal-link">x</a></p>')
  })

  it('links person marks to /person/<slug>', () => {
    const html = blocksToHtml([{
      _key: 'b', _type: 'block',
      markDefs: [{ _key: 'p', _type: 'person', slug: 'martin-linge', name: 'Martin Linge' }],
      children: [{ _key: 's', _type: 'span', text: 'Linge', marks: ['p'] }],
    }])
    expect(html).toBe('<p><a href="/person/martin-linge" class="internal-link person-link">Linge</a></p>')
  })

  it('groups list items and closes the list before the next paragraph', () => {
    const html = blocksToHtml([
      block({ text: 'a', listItem: 'bullet', level: 1 }),
      block({ text: 'b', listItem: 'bullet', level: 1 }),
      block({ text: 'after' }),
    ])
    expect(html).toBe('<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n<p>after</p>')
  })

  it('uses <ol> for numbered lists', () => {
    expect(blocksToHtml([block({ text: 'a', listItem: 'number' })])).toBe('<ol>\n<li>a</li>\n</ol>')
  })

  it('merges consecutive tab-separated rows into one <pre>', () => {
    const html = blocksToHtml([block({ text: 'a\tb' }), block({ text: 'c\td' }), block({ text: 'end' })])
    expect(html).toBe('<pre class="pre-table">a\tb\nc\td</pre>\n<p>end</p>')
  })

  it('ignores non-block items', () => {
    expect(blocksToHtml([{ _key: 'i', _type: 'image' }])).toBe('')
  })
})

describe('blocksToText', () => {
  it('joins block text with newlines and trims', () => {
    expect(blocksToText([block({ text: 'one' }), block({ text: 'two' })])).toBe('one\ntwo')
  })

  it('returns an empty string for missing input', () => {
    expect(blocksToText(null)).toBe('')
  })
})
