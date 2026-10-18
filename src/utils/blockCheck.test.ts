import { describe, expect, it } from 'vitest'
import { checkBlocks, checkSections, type BlockKind } from './blockCheck.ts'

const span = (text: string, marks: string[] = [], key = `s-${text}`) => ({ _key: key, _type: 'span', text, marks })
const block = (key: string, children: ReturnType<typeof span>[], extra: Record<string, unknown> = {}) =>
  ({ _key: key, _type: 'block', style: 'normal', markDefs: [], children, ...extra })
const para = (key: string, text = 'Tekst') => block(key, [span(text)])
const item = (key: string, level?: number, listItem: 'bullet' | 'number' = 'bullet') =>
  block(key, [span(`punkt ${key}`)], { listItem, ...(level === undefined ? {} : { level }) })
const heading = (key: string, text: string, style = 'h3') => block(key, text ? [span(text)] : [], { style })

/** The kinds found in blocks, in order. */
const kinds = (blocks: unknown[]): BlockKind[] => checkBlocks(blocks).map(f => f.kind)

describe('checkBlocks: one block, or the one before it', () => {
  it('finds nothing in a clean description', () => {
    const clean = [
      para('a'),
      block('b', [span('fet', ['strong']), span(' og '), span('lenke', ['m1'])], { markDefs: [{ _key: 'm1', _type: 'link', href: '/events/x' }] }),
      item('c', 1), item('d', 2), item('e', 1),
    ]
    expect(checkBlocks(clean)).toEqual([])
  })

  it('stray list level: a level on a block that is not a list item', () => {
    const [f] = checkBlocks([block('a', [span('Avsnitt')], { level: 2 })])
    expect(f).toMatchObject({ kind: 'stray-list-level', blockKey: 'a', text: 'Avsnitt' })
    expect(f.detail).toContain('Nivå 2')
  })

  it('stray list level: a list item with a level is fine, and so is a block with neither', () => {
    expect(kinds([item('a', 3), para('b')])).toEqual([])
  })

  it('list level jump: an item two levels deeper than the one before', () => {
    const found = checkBlocks([item('a', 1), item('b', 3)])
    expect(found.map(f => [f.kind, f.blockKey])).toEqual([['list-level-jump', 'b']])
    expect(found[0].detail).toContain('nivå 3')
  })

  it('list level jump: one level deeper, going back up, or a list that starts deep are not jumps', () => {
    expect(kinds([item('a', 1), item('b', 2), item('c', 1)])).toEqual([])
    expect(kinds([item('a', 3), item('b', 1)])).toEqual([])
    expect(kinds([para('p'), item('a', 3)])).toEqual([])            // judged against an item before it, not against nothing
  })

  it('list level jump: an item with no level counts as level 1', () => {
    expect(kinds([item('a'), item('b', 3)])).toEqual(['list-level-jump'])
  })

  it('list level jump: a paragraph between two items ends the comparison', () => {
    expect(kinds([item('a', 1), para('p'), item('b', 3)])).toEqual([])
  })

  it('unused definition: a link and a person no span uses', () => {
    const b = block('a', [span('ingen merker')], {
      markDefs: [
        { _key: 'l1', _type: 'link', href: '/events/x' },
        { _key: 'p1', _type: 'person', slug: 'bernt-balchen', name: 'Bernt Balchen' },
      ],
    })
    const found = checkBlocks([b])
    expect(found.map(f => f.kind)).toEqual(['unused-definition', 'unused-definition'])
    expect(found[0].detail).toContain('/events/x')
    expect(found[1].detail).toContain('Bernt Balchen')
  })

  it('unused definition: a definition one span uses is used', () => {
    const b = block('a', [span('a'), span('b', ['l1'])], { markDefs: [{ _key: 'l1', _type: 'link', href: '/x' }] })
    expect(kinds([b])).toEqual([])
  })

  it('dangling mark: a span names a mark with no definition', () => {
    const [f] = checkBlocks([block('a', [span('tekst', ['m9'])])])
    expect(f).toMatchObject({ kind: 'dangling-mark', blockKey: 'a' })
    expect(f.detail).toContain('m9')
  })

  it('dangling mark: the decorators the page draws need no definition', () => {
    const marks = ['strong', 'em', 'underline', 'strike-through', 'code']
    expect(kinds([block('a', [span('x', marks)])])).toEqual([])
  })

  it('typed markup: tags and entities in the text', () => {
    for (const text of ['første<br>andre', 'en <b>fet</b> tekst', 'to&nbsp;ord', 'a &amp; b', 'tegn &#229; her']) {
      expect(kinds([para('a', text)]), text).toEqual(['typed-markup'])
    }
  })

  it('typed markup: a lone < or & is ordinary text', () => {
    for (const text of ['5 < 7', 'AT&T', 'a<b', 'Tom & Jerry']) {
      expect(kinds([para('a', text)]), text).toEqual([])
    }
  })

  it('cuts a long text short', () => {
    const [f] = checkBlocks([block('a', [span('x'.repeat(200))], { level: 1 })])
    expect(f.text.length).toBe(80)
    expect(f.text.endsWith('…')).toBe(true)
  })

  it('ignores what is not a block, and what is not a list', () => {
    expect(checkBlocks([{ _key: 'i', _type: 'image' }, null, 'text'])).toEqual([])
    expect(checkBlocks(null)).toEqual([])
    expect(checkBlocks({})).toEqual([])
  })
})

describe('checkSections: the sections of one entity', () => {
  const json = (blocks: unknown[]) => JSON.stringify(blocks)

  it('finds nothing in a clean entity', () => {
    expect(checkSections([json([heading('h', 'Bakgrunn'), para('p')]), json([heading('h2', 'Mer', 'h3'), para('q')])])).toEqual([])
  })

  it('empty heading: its own kind, not an outline problem', () => {
    const found = checkSections([json([heading('h', '')])])
    expect(found.map(f => [f.kind, f.content, f.blockKey])).toEqual([['empty-heading', 0, 'h']])
  })

  it('heading outline: too shallow, and a skipped level, with the same message as the refused save', () => {
    const found = checkSections([json([heading('a', 'For grunn', 'h2'), heading('b', 'Første', 'h3'), heading('c', 'Hoppet over', 'h5')])])
    expect(found.map(f => [f.kind, f.blockKey])).toEqual([['heading-outline', 'a'], ['heading-outline', 'c']])
    expect(found[0].detail).toContain('H2')
    expect(found[1].detail).toContain('høyst H4')
  })

  it('cuts a long heading short in the message too', () => {
    const [f] = checkSections([json([heading('a', 'x'.repeat(200), 'h1')])])
    expect(f.kind).toBe('heading-outline')
    expect(f.detail.length).toBeLessThan(200)
    expect(f.detail).toContain('…')
  })

  it('reads the sections as one outline: the second section continues the first', () => {
    // h3 in section 0, then an h5 at the start of section 1 skips h4: it is only wrong across the two.
    const found = checkSections([json([heading('a', 'Først')]), json([heading('b', 'Dypt', 'h5')])])
    expect(found.map(f => [f.kind, f.content, f.blockKey])).toEqual([['heading-outline', 1, 'b']])
  })

  it('gives the block findings the section they are in', () => {
    const found = checkSections([json([para('a')]), json([block('b', [span('x', ['m9'])])])])
    expect(found.map(f => [f.kind, f.content])).toEqual([['dangling-mark', 1]])
  })

  it('does not count a list item as a heading, as the page does not (#144)', () => {
    const asItem = block('a', [span('Punkt')], { style: 'h1', listItem: 'bullet', level: 1 })
    expect(checkSections([json([asItem])])).toEqual([])
  })

  it('treats content that is not JSON, or not a list, as no blocks', () => {
    expect(checkSections(['not json', '{"a":1}', ''])).toEqual([])
  })

  it('says an unused definition once per section, however many blocks carry it', () => {
    const def = [{ _key: 'l1', _type: 'link', href: '/events/x' }]
    const carrying = (key: string) => block(key, [span('uten merke')], { markDefs: def })
    const found = checkSections([json([carrying('a'), carrying('b'), carrying('c')]), json([carrying('d')])])
    expect(found.map(f => [f.kind, f.content, f.blockKey])).toEqual([['unused-definition', 0, 'a'], ['unused-definition', 1, 'd']])
    expect(found[0].detail).toContain('Det samme i 2 blokker til.')
    expect(found[1].detail).not.toContain('blokker til')
  })

  it('keeps two different unused definitions apart', () => {
    const one = block('a', [span('x')], { markDefs: [{ _key: 'l1', _type: 'link', href: '/a' }, { _key: 'l2', _type: 'link', href: '/b' }] })
    expect(checkSections([json([one])]).map(f => f.kind)).toEqual(['unused-definition', 'unused-definition'])
  })

  it('honours the section level it is given', () => {
    const found = checkSections([json([heading('a', 'Tittel', 'h3')])], { sectionLevel: 3 })
    expect(found.map(f => f.kind)).toEqual(['heading-outline'])
  })
})

// Containers (#308, #314): a box and a table hold lists of blocks of their own.
describe('containers', () => {
  const box = (key: string, ...content: unknown[]) => ({ _type: 'infoBox', _key: key, content })
  const cell = (key: string, ...content: unknown[]) => ({ _type: 'cell', _key: key, content })
  const grid = (key: string, ...cells: unknown[]) => ({ _type: 'table', _key: key, rows: [{ _type: 'row', _key: `${key}-r`, cells }] })
  const found = (blocks: unknown[]) => checkBlocks(blocks).map(f => `${f.kind}@${f.blockKey}`)

  it('finds in a box and in a cell what it finds at the top, naming the block', () => {
    const typed = block('typed', [span('a<br>b')])
    const dangling = block('dangling', [span('x', ['ghost'])])
    const unused = block('unused', [span('y')], { markDefs: [{ _key: 'm1', _type: 'link', href: '/events/x' }] })
    const stray = block('stray', [span('z')], { level: 2 })
    expect(found([box('b1', typed), grid('t1', cell('c1', dangling, unused), cell('c2', stray))])).toEqual([
      'typed-markup@typed', 'dangling-mark@dangling', 'unused-definition@unused', 'stray-list-level@stray',
    ])
  })

  it('finds a list level jump inside a cell', () => {
    expect(found([grid('t', cell('c', item('a', 1), item('b', 3)))])).toEqual(['list-level-jump@b'])
  })

  it('does not compare the first block of a box or a cell with what comes before it', () => {
    expect(found([item('a', 1), box('b', item('c', 3))])).toEqual([])
    expect(found([grid('t', cell('c1', item('a', 1)), cell('c2', item('b', 3)))])).toEqual([])
    expect(found([box('b', item('a', 1)), item('c', 3)])).toEqual([])
  })

  it('finds the same things in a box inside nothing else as in a table inside a box', () => {
    expect(found([box('b', grid('t', cell('c', block('typed', [span('<b>x</b>')]))))])).toEqual(['typed-markup@typed'])
  })

  it('reads a container it does not know the same way', () => {
    expect(found([{ _type: 'columns', _key: 'k', left: [block('typed', [span('&nbsp;')])] }])).toEqual(['typed-markup@typed'])
  })

  describe('checkSections', () => {
    const sections = (...blocks: unknown[][]) => blocks.map(b => JSON.stringify(b))

    it('gives a finding in a container the section it is in', () => {
      const out = checkSections(sections([para('a')], [box('b', block('typed', [span('<i>x</i>')]))]))
      expect(out.map(f => `${f.content}:${f.kind}:${f.blockKey}`)).toEqual(['1:typed-markup:typed'])
    })

    it('shows a heading in a table cell as a heading-outline finding, with the sentence of the refused save', () => {
      const out = checkSections(sections([heading('h', 'Overskrift'), grid('t', cell('c', heading('ch', 'Celle')))]))
      expect(out).toHaveLength(1)
      expect(out[0]).toMatchObject({ kind: 'heading-outline', content: 0, blockKey: 'ch', text: 'Celle' })
      expect(out[0].detail).toContain('står i en tabellcelle')
    })

    it('shows a heading in a box that is too deep, and counts it in the outline', () => {
      const out = checkSections(sections([heading('h', 'A'), box('b', heading('deep', 'B', 'h5'))]))
      expect(out.map(f => `${f.kind}:${f.blockKey}`)).toEqual(['heading-outline:deep'])
    })

    it('says an unused definition once per section even when the blocks are in different cells', () => {
      const unused = (key: string) => block(key, [span('y')], { markDefs: [{ _key: 'm1', _type: 'link', href: '/events/x' }] })
      const out = checkSections(sections([grid('t', cell('c1', unused('a')), cell('c2', unused('b')), cell('c3', unused('c')))]))
      expect(out).toHaveLength(1)
      expect(out[0].detail).toContain('Det samme i 2 blokker til.')
    })
  })
})
