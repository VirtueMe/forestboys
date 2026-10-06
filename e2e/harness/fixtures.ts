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

  headings: [
    block('h1', 'Bakgrunn', { style: 'h3' }),
    block('h2', 'Detaljer', { style: 'h4' }),
    block('p1', 'Tekst under overskriftene.'),
  ],

  // Enough text that the editor's box scrolls inside itself (#123).
  long: Array.from({ length: 40 }, (_, i) => block(`p${i}`, `Avsnitt nummer ${i + 1}. `.repeat(6))),
}
