import type { Block } from './types.ts'

const span = (key: string, text: string, marks: string[] = []) => ({ _key: key, _type: 'span', text, marks })
const block = (key: string, text: string, extra: Partial<Block> = {}): Block => ({
  _key: key, _type: 'block', style: 'normal', markDefs: [], children: [span(`${key}s`, text)], ...extra,
})

/** Named starting contents for the editor harness: `editor.html?fixture=<name>`. */
export const fixtures: Record<string, Block[]> = {
  empty: [],

  paragraph: [block('p1', 'Første avsnitt.')],

  // Bullets at two levels, a numbered item, then a paragraph (the shape #124 is about).
  lists: [
    block('l1', 'Første punkt', { listItem: 'bullet', level: 1 }),
    block('l2', 'Andre punkt', { listItem: 'bullet', level: 1 }),
    block('l3', 'Underpunkt', { listItem: 'bullet', level: 2 }),
    block('l4', 'Første nummer', { listItem: 'number', level: 1 }),
    block('p1', 'Et avsnitt etter listen.'),
  ],

  // A link, a person mark and bold text in one paragraph, each with its markDef.
  links: [{
    _key: 'k1', _type: 'block', style: 'normal',
    markDefs: [
      { _key: 'mlink', _type: 'link', href: '/events/forste-mote-om-mostandsbevegelse-i-london' },
      { _key: 'mperson', _type: 'person', slug: 'bernt-balchen', name: 'Bernt Balchen' },
    ],
    children: [
      span('c1', 'Se '),
      span('c2', 'det første møtet', ['mlink']),
      span('c3', ' og '),
      span('c4', 'Bernt Balchen', ['mperson']),
      span('c5', ' og ', []),
      span('c6', 'noe fet tekst', ['strong']),
      span('c7', '.'),
    ],
  }],

  // A link whose words are all bold: replacing them must keep the bold and the link.
  boldLink: [{
    _key: 'b1', _type: 'block', style: 'normal',
    markDefs: [{ _key: 'mlink', _type: 'link', href: '/events/forste-mote-om-mostandsbevegelse-i-london' }],
    children: [span('c1', 'Se '), span('c2', 'det fete møtet', ['mlink', 'strong']), span('c3', ' nå.')],
  }],

  // A link whose words are partly bold: its text cannot be replaced without losing the bold.
  mixedLink: [{
    _key: 'x1', _type: 'block', style: 'normal',
    markDefs: [{ _key: 'mlink', _type: 'link', href: '/events/forste-mote-om-mostandsbevegelse-i-london' }],
    children: [span('c1', 'Se '), span('c2', 'del ', ['mlink']), span('c3', 'fet', ['mlink', 'strong']), span('c4', ' nå.')],
  }],

  headings: [
    block('h1', 'Bakgrunn', { style: 'h3' }),
    block('h2', 'Detaljer', { style: 'h4' }),
    block('p1', 'Tekst under overskriftene.'),
  ],

  // What the other marks and styles are drawn as: italic, underline, a quote, and a link with no address.
  marks: [
    {
      _key: 'm1', _type: 'block', style: 'normal',
      markDefs: [{ _key: 'mdead', _type: 'link' }],
      children: [span('c1', 'kursiv', ['em']), span('c2', ' '), span('c3', 'understrek', ['underline']), span('c4', ' '), span('c5', 'død lenke', ['mdead'])],
    },
    block('q1', 'Et sitat.', { style: 'blockquote' }),
    block('t1', '1.  Første\n2.  Andre', { style: 'preformatted' }),
  ],

  // A paragraph, a box with a paragraph and a table in it, and a table of its own (#312).
  containers: [
    block('c0', 'Før boksen.'),
    {
      _key: 'box', _type: 'infoBox', content: [
        block('bx1', 'I boksen.'),
        { _key: 'tin', _type: 'table', rows: [{ _key: 'ri', _type: 'row', cells: [
          { _key: 'ci1', _type: 'cell', content: [block('ti1', 'A1')] },
          { _key: 'ci2', _type: 'cell', content: [block('ti2', 'B1')] },
        ] }] },
      ],
    },
    { _key: 'tab', _type: 'table', rows: [{ _key: 'ra', _type: 'row', cells: [
      { _key: 'ca1', _type: 'cell', content: [block('ta1', 'CON'), block('ta1b', 'PAK')] },
      { _key: 'ca2', _type: 'cell', content: [block('ta2', '16')] },
    ] }] },
    block('c9', 'Etter tabellen.'),
  ],

  // Enough text that the editor's box scrolls inside itself (#123).
  long: Array.from({ length: 40 }, (_, i) => block(`p${i}`, `Avsnitt nummer ${i + 1}. `.repeat(6))),
}
