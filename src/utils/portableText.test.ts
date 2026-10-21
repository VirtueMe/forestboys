import { describe, expect, it } from 'vitest'
import { blocksToHtml, blocksToText, hasLinkMark, type SanityBlock } from './portableText'

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

  it('renders every heading level the editor can set, h3 to h6', () => {
    for (const level of ['h3', 'h4', 'h5', 'h6']) {
      expect(blocksToHtml([block({ text: 'T', style: level })])).toBe(`<${level}>T</${level}>`)
    }
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

  describe('link targets as they were typed in Sanity', () => {
    const link = (href: string) => blocksToHtml([{
      _key: 'b', _type: 'block',
      markDefs: [{ _key: 'l', _type: 'link', href }],
      children: [{ _key: 's', _type: 'span', text: 'x', marks: ['l'] }],
    }])

    it('ignores spaces around the target', () => {
      expect(link('mtb-x037 ')).toBe('<p><a href="/events/mtb-x037" class="internal-link">x</a></p>')
      expect(link('  https://nb.no/x ')).toContain('href="https://nb.no/x"')
    })

    it('turns ../kind/slug into the page of that kind', () => {
      expect(link('../people/harry-sporborg')).toContain('href="/person/harry-sporborg"')
      expect(link('../locations/88-chiltern-court')).toContain('href="/map/88-chiltern-court"')
      expect(link('../outlines/soe-operasjon-foscott')).toContain('href="/outlines/soe-operasjon-foscott"')
      expect(link('../../people/x')).toContain('href="/person/x"')
    })

    it('treats a ../ path of an unknown kind as an event slug', () => {
      expect(link('../things/abc')).toContain('href="/events/abc"')
    })

    it('makes mailto: a plain link and finds a URL buried in other text', () => {
      expect(link('mailto:a@b.no')).toBe('<p><a href="mailto:a@b.no" class="external-link">x</a></p>')
      expect(link('Se https://example.org/a/b.')).toContain('href="https://example.org/a/b"')
      expect(link('(https://example.org/a')).toContain('target="_blank"')
    })

    it('encodes a slug with a space and a slash', () => {
      expect(link('East BOAC/BALDER-040445')).toContain('href="/events/East%20BOAC%2FBALDER-040445"')
    })

    it('does not let a quote in the target out of the attribute', () => {
      expect(link('a" onmouseover="x')).not.toContain('onmouseover="x"')
    })

    it('renders a link with nothing in it as plain text', () => {
      expect(link('')).toBe('<p>x</p>')
      expect(link('   ')).toBe('<p>x</p>')
    })
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

  it('puts a nested list inside the parent <li>', () => {
    const html = blocksToHtml([
      block({ text: 'a', listItem: 'number', level: 1 }),
      block({ text: 'b', listItem: 'bullet', level: 2 }),
      block({ text: 'c', listItem: 'number', level: 1 }),
    ])
    expect(html).toBe('<ol>\n<li>a\n<ul>\n<li>b</li>\n</ul></li>\n<li>c</li>\n</ol>')
  })

  it('closes every open list when a paragraph follows a nested list', () => {
    const html = blocksToHtml([
      block({ text: 'a', listItem: 'bullet', level: 1 }),
      block({ text: 'b', listItem: 'bullet', level: 2 }),
      block({ text: 'after' }),
    ])
    expect(html).toBe('<ul>\n<li>a\n<ul>\n<li>b</li>\n</ul></li>\n</ul>\n<p>after</p>')
  })

  it('starts a new list when the list type changes at the same level', () => {
    const html = blocksToHtml([
      block({ text: 'a', listItem: 'bullet', level: 1 }),
      block({ text: 'b', listItem: 'number', level: 1 }),
    ])
    expect(html).toBe('<ul>\n<li>a</li>\n</ul>\n<ol>\n<li>b</li>\n</ol>')
  })

  it('draws a tab in an ordinary paragraph as a paragraph: only the preformatted style makes a table (#260)', () => {
    const rows = 'Laks\t24.03.1945\t25.03.1945 858\tB-24L-5-FO\t44-49338\tBrer Rabbitt\t9A-D\t2Lt. Orban\t12\t9 NC\tChaffinch\tHS8-146 s178'
    const html = blocksToHtml([block({ text: 'a\tb' }), block({ text: 'c\td' }), block({ text: rows }), block({ text: '1.\tPoints arising' })])
    expect(html).not.toContain('<pre')
    expect(html).toBe(`<p>a\tb</p>\n<p>c\td</p>\n<p>${rows}</p>\n<p>1.\tPoints arising</p>`)
  })

  it('renders the preformatted style as a <pre>, with or without a tab, and merges consecutive blocks', () => {
    const html = blocksToHtml([block({ text: '1. One', style: 'preformatted' }), block({ text: '2. Two', style: 'preformatted' }), block({ text: 'end' })])
    expect(html).toBe('<pre class="pre-table">1. One\n2. Two</pre>\n<p>end</p>')
  })

  it('does not merge a heading or a quote into the preformatted rows around it', () => {
    const html = blocksToHtml([block({ text: 'a', style: 'preformatted' }), block({ text: 'H', style: 'h3' }), block({ text: 'b', style: 'preformatted' })])
    expect(html).toBe('<pre class="pre-table">a</pre>\n<h3>H</h3>\n<pre class="pre-table">b</pre>')
  })

  describe('containers (#313)', () => {
    const cell = (...blocks: unknown[]) => ({ _type: 'cell', _key: 'c', content: blocks })
    const row = (...cells: ReturnType<typeof cell>[]) => ({ _type: 'row', _key: 'r', cells })
    const table = (rows: ReturnType<typeof row>[], over: Record<string, unknown> = {}) => ({ _type: 'table', _key: 't', rows, ...over })
    const box = (...content: unknown[]) => ({ _type: 'infoBox', _key: 'b', content })
    const p = (text: string, over: Partial<SanityBlock> = {}) => block({ text, ...over })

    it('draws a box around its blocks', () => {
      expect(blocksToHtml([box(p('Merk dette'))])).toBe('<div class="pt-box"><p>Merk dette</p></div>')
    })

    it('draws a table as rows of cells, each cell as the blocks it holds', () => {
      const t = table([row(cell(p('CON')), cell(p('PAK'))), row(cell(p('16')), cell(p('a'), p('b')))])
      expect(blocksToHtml([t])).toBe(
        '<div class="pt-table-wrap"><table class="pt-table"><tbody>'
        + '<tr><td><p>CON</p></td><td><p>PAK</p></td></tr>'
        + '<tr><td><p>16</p></td><td><p>a</p>\n<p>b</p></td></tr>'
        + '</tbody></table></div>')
    })

    it('pads a short row so the columns line up', () => {
      const html = blocksToHtml([table([row(cell(p('a')), cell(p('b'))), row(cell(p('c')))])])
      expect(html).toContain('<tr><td><p>c</p></td><td></td></tr>')
    })

    it('turns the options of a table into classes, and none into a plain table', () => {
      const rows = [row(cell(p('a')))]
      expect(blocksToHtml([table(rows, { frame: 'topBottom', rowLines: true, columnLines: true })]))
        .toContain('<table class="pt-table pt-table--topbottom pt-table--rows pt-table--columns">')
      expect(blocksToHtml([table(rows, { frame: 'around' })])).toContain('class="pt-table pt-table--around"')
      expect(blocksToHtml([table(rows, { frame: 'none', rowLines: false })])).toContain('<table class="pt-table">')
      expect(blocksToHtml([table(rows, { width: 'full' })])).toContain('<table class="pt-table pt-table--full">')
      expect(blocksToHtml([table(rows, { width: 'compact' })])).toContain('<table class="pt-table">')
      expect(blocksToHtml([table(rows, { noWrap: true })])).toContain('<table class="pt-table pt-table--nowrap">')
      expect(blocksToHtml([table(rows, { noWrap: false })])).toContain('<table class="pt-table">')
      expect(blocksToHtml([table(rows, { width: 'full', noWrap: true, rowLines: true })])).toContain('<table class="pt-table pt-table--full pt-table--nowrap pt-table--rows">')
    })

    it('draws a table inside a box, and a list, a link and a mark inside a cell', () => {
      const linked = block({ text: 'AM 380', marks: ['m1'], markDefs: [{ _key: 'm1', _type: 'link', href: '/events/am-380' }] })
      const t = table([row(cell(p('en', { listItem: 'bullet' }), p('to', { listItem: 'bullet' })), cell(linked))])
      const html = blocksToHtml([box(p('Før'), t)])
      expect(html).toContain('<td><ul>\n<li>en</li>\n<li>to</li>\n</ul></td>')
      expect(html).toContain('<td><p><a href="/events/am-380" class="internal-link">AM 380</a></p></td>')
      expect(html).toMatch(/^<div class="pt-box"><p>Før<\/p>\n<div class="pt-table-wrap">.*<\/div><\/div>$/s)
    })

    it('ends a list and a fixed-width run before a container, and starts new ones after it', () => {
      const html = blocksToHtml([
        p('a', { listItem: 'bullet' }), box(p('x')), p('b', { listItem: 'bullet' }),
        p('pre1', { style: 'preformatted' }), box(p('y')), p('pre2', { style: 'preformatted' }),
      ])
      expect(html).toBe('<ul>\n<li>a</li>\n</ul>\n<div class="pt-box"><p>x</p></div>\n<ul>\n<li>b</li>\n</ul>\n'
        + '<pre class="pre-table">pre1</pre>\n<div class="pt-box"><p>y</p></div>\n<pre class="pre-table">pre2</pre>')
    })

    it('draws a container it does not know, and a row or a cell on its own, as what they hold', () => {
      expect(blocksToHtml([{ _type: 'columns', _key: 'k', left: [p('venstre')], right: [p('høyre')] }])).toBe('<p>venstre</p>\n<p>høyre</p>')
      expect(blocksToHtml([row(cell(p('alene')))])).toBe('<p>alene</p>')
    })

    it('draws nothing for an empty box or table, and still skips an object with no content', () => {
      expect(blocksToHtml([box(), table([]), table([row()]), { _type: 'image', _key: 'i' }, p('rest')])).toBe('<p>rest</p>')
    })
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

  describe('containers (#313)', () => {
    const cell = (...texts: string[]) => ({ _type: 'cell', _key: 'c', content: texts.map(text => block({ text })) })
    const row = (...cells: ReturnType<typeof cell>[]) => ({ _type: 'row', _key: 'r', cells })
    const table = (...rows: ReturnType<typeof row>[]) => ({ _type: 'table', _key: 't', rows })
    const box = (...content: unknown[]) => ({ _type: 'infoBox', _key: 'b', content })

    it('reads a table as rows on lines and cells separated by a tab', () => {
      const t = table(row(cell('CON'), cell('PAK')), row(cell('16'), cell('3')))
      expect(blocksToText([block({ text: 'before' }), t, block({ text: 'after' })])).toBe('before\nCON\tPAK\n16\t3\nafter')
    })

    it('puts the blocks of a cell on one line, and drops a trailing empty cell', () => {
      expect(blocksToText([table(row(cell('a', 'b'), cell('c'), cell('')))])).toBe('a b\tc')
    })

    it('reads a box one block to a line, with a table inside it', () => {
      expect(blocksToText([box(block({ text: 'Merk' }), table(row(cell('x'), cell('y'))), block({ text: 'slutt' }))])).toBe('Merk\nx\ty\nslutt')
    })

    it('reads a container it does not know as its contents, so no text is lost', () => {
      const unknown = { _type: 'columns', _key: 'k', left: [block({ text: 'venstre' })], right: [block({ text: 'høyre' })] }
      expect(blocksToText([unknown])).toBe('venstre\nhøyre')
    })

    it('skips an object with no text, as it always did', () => {
      expect(blocksToText([block({ text: 'a' }), { _type: 'image', _key: 'i' }, block({ text: 'b' })])).toBe('a\n\nb')
    })
  })
})

describe('hasLinkMark', () => {
  const linked = (marks: string[], defs: SanityBlock['markDefs']) =>
    [block({ text: 'AIR-27-2165', marks, markDefs: defs })]

  it('is true when a span carries a link mark', () => {
    expect(hasLinkMark(linked(['m1'], [{ _key: 'm1', _type: 'link', href: '/events/x' }]))).toBe(true)
  })

  it('is true for a link on only some of the spans', () => {
    const blocks = [block({
      text: 'plain', markDefs: [{ _key: 'm1', _type: 'link', href: 'x' }],
      children: [
        { _key: 'a', _type: 'span', text: 'plain' },
        { _key: 'b', _type: 'span', text: 'linked', marks: ['strong', 'm1'] },
      ],
    })]
    expect(hasLinkMark(blocks)).toBe(true)
  })

  it('is false for a person mark, or for decorators only', () => {
    expect(hasLinkMark(linked(['p1'], [{ _key: 'p1', _type: 'person', slug: 'x' }]))).toBe(false)
    expect(hasLinkMark(linked(['strong', 'underline'], []))).toBe(false)
  })

  it('is false when the def is not used by any span', () => {
    expect(hasLinkMark(linked([], [{ _key: 'm1', _type: 'link', href: 'x' }]))).toBe(false)
  })

  it('is false for nothing, and ignores items that are not blocks', () => {
    expect(hasLinkMark([])).toBe(false)
    expect(hasLinkMark([{ _key: 'i', _type: 'image' }, null])).toBe(false)
  })
})

describe('hasLinkMark inside containers (#314)', () => {
  const linked = block({ text: 'AIR-27-2165', marks: ['m1'], markDefs: [{ _key: 'm1', _type: 'link', href: '/events/x' }] })
  const unused = block({ text: 'ingen lenke', markDefs: [{ _key: 'm1', _type: 'link', href: '/events/x' }] })
  const box = (...content: unknown[]) => ({ _type: 'infoBox', _key: 'b', content })
  const grid = (...content: unknown[]) => ({ _type: 'table', _key: 't', rows: [{ _type: 'row', _key: 'r', cells: [{ _type: 'cell', _key: 'c', content }] }] })

  it('finds a link mark in a box and in a table cell', () => {
    expect(hasLinkMark([block({ text: 'a' }), box(linked)])).toBe(true)
    expect(hasLinkMark([block({ text: 'a' }), grid(linked)])).toBe(true)
    expect(hasLinkMark([box(grid(linked))])).toBe(true)
  })

  it('does not count a definition in a container that no span uses', () => {
    expect(hasLinkMark([box(unused), grid(unused)])).toBe(false)
  })
})

