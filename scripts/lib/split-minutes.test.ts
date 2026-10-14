import { describe, expect, it } from 'vitest'
import { checkContents } from '../../src/utils/headingOutline.ts'
import type { SanityBlock, SanityMarkDef } from '../../src/utils/portableText.ts'
import { applyCorrections, restructureMinutes, sameText, splitMinutes, cutSections } from './split-minutes.ts'

type Spec = string | [text: string, ...marks: string[]]

const block = (spans: Spec[], over: Partial<SanityBlock> = {}): SanityBlock => ({
  _key: 'b',
  _type: 'block',
  style: 'normal',
  markDefs: [],
  children: spans.map((s, i) => {
    const [text, ...marks] = typeof s === 'string' ? [s] : s
    return { _key: `s${i}`, _type: 'span', text, marks }
  }),
  ...over,
})

const EMPH = ['strong', 'underline']
const shape = (blocks: SanityBlock[]) =>
  blocks.map(b => `${b.style}: ${(b.children ?? []).map(c => c.text).join('')}`)

describe('splitMinutes', () => {
  it('cuts a giant block into a block per line, with the numbered and lettered lines as headings', () => {
    const before = [
      block([['Minutes of the fourth meeting.\n']], { style: 'h5' }),
      block([
        ['1. Arising from Minutes', ...EMPH], '\n',
        ['(a)\tWater-tight containers', 'underline'], '\nIt was reported that testing is still proceeding.\n',
        ['(b)\tPay and allowances', 'underline'], '\nForm giving full details has been furnished.\n',
      ]),
      block([['Dropping of leaflets', ...EMPH], '\nSN reported that he had been in communication.']),
    ]
    const after = splitMinutes(before, 'ancc-04')
    expect(shape(after)).toEqual([
      'h3: Minutes of the fourth meeting.',
      'h4: 1. Arising from Minutes',
      'h5: (a) Water-tight containers',
      'normal: It was reported that testing is still proceeding.',
      'h5: (b) Pay and allowances',
      'normal: Form giving full details has been furnished.',
      'h4: Dropping of leaflets',
      'normal: SN reported that he had been in communication.',
    ])
    expect(sameText(before, after)).toBe(true)
    expect(checkContents([JSON.stringify(after)])).toEqual([])
  })

  it('leaves no tab behind a marker: a short tab block would render as a table again', () => {
    const after = splitMinutes([block(['1.\tPoints arising\n(a)\tRole of the unit\n(b)\tCapture of vessels'])], 's')
    expect(shape(after)).toEqual(['normal: 1. Points arising', 'normal: (a) Role of the unit', 'normal: (b) Capture of vessels'])
    expect(after.some(b => b.children?.some(c => c.text?.includes('\t')))).toBe(false)
  })

  it('cuts a numbered heading from the text after it on the same line', () => {
    const after = splitMinutes([block([['2. Propaganda. ', ...EMPH], 'SN/I and Hackett have visited the school.'])], 's')
    expect(shape(after)).toEqual(['h3: 2. Propaganda.', 'normal: SN/I and Hackett have visited the school.'])
  })

  it('does not cut a heading the text after it continues', () => {
    const lower = splitMinutes([block([['1. Points arising', ...EMPH], ' out of the Minutes of the meeting.'])], 's')
    expect(shape(lower)).toEqual(['normal: 1. Points arising out of the Minutes of the meeting.'])
    const stop = splitMinutes([block([['3. Directives for planning in Norway', ...EMPH], '. This has been put on the Agenda.'])], 's')
    expect(shape(stop)).toEqual(['normal: 3. Directives for planning in Norway. This has been put on the Agenda.'])
  })

  it('does not make a heading of a lone number, an archive reference, or a closing line', () => {
    const lone = splitMinutes([block([['11.\t', ...EMPH], 'D/CD reported that he had received a memorandum.'])], 's')
    expect(shape(lone)).toEqual(['normal: 11. D/CD reported that he had received a memorandum.'])
    const ref = splitMinutes([block([['HS2-138 ANCC', ...EMPH]])], 's')
    expect(shape(ref)).toEqual(['normal: HS2-138 ANCC'])
    const last = splitMinutes([block(['Body line.\n', ['Closing words in bold', ...EMPH]])], 's')
    expect(last.map(b => b.style)).toEqual(['normal', 'normal'])
  })

  it('joins a wrapped line that starts in lower case onto the line above', () => {
    const after = splitMinutes([block(['The three sub-chasers are very much liked and their equipment for our\nnearly completed. One has been sent.\nSub. Lt. Larsen was invested.'])], 's')
    expect(shape(after)).toEqual([
      'normal: The three sub-chasers are very much liked and their equipment for our nearly completed. One has been sent.',
      'normal: Sub. Lt. Larsen was invested.',
    ])
  })

  it('keeps a line in columns as it is, one line to a block', () => {
    const memo = 'DS/SN/438                                  10. November 1943'
    const after = splitMinutes([block([`${memo}\nTO: AD/E`])], 's')
    expect(shape(after)).toEqual([`normal: ${memo}`, 'normal: TO: AD/E'])
    const row = splitMinutes([block(['Laks\t24.03.1945\tB-24L'])], 's')
    expect(row[0].children?.[0].text).toBe('Laks\t24.03.1945\tB-24L')
  })

  it('keeps the marks, and of the link definitions only those a block uses', () => {
    const defs: SanityMarkDef[] = [{ _key: 'k1', _type: 'link', href: 'https://a.example' }, { _key: 'k2', _type: 'link', href: 'https://b.example' }]
    const after = splitMinutes([block(['See ', ['the paper', 'k1'], '.\nAnd ', ['another', 'k2'], '.'], { markDefs: defs })], 's')
    expect(after).toHaveLength(2)
    expect(after[0].markDefs?.map(d => d._key)).toEqual(['k1'])
    expect(after[1].markDefs?.map(d => d._key)).toEqual(['k2'])
    expect(after[0].children?.[1]).toMatchObject({ text: 'the paper', marks: ['k1'] })
  })

  it('takes the emphasis off a heading and keeps a link on it', () => {
    const defs: SanityMarkDef[] = [{ _key: 'k1', _type: 'link', href: 'https://a.example' }]
    const after = splitMinutes([block([['(a) "Clairvoyant"', 'strong', 'k1'], '\nIt was reported.'], { markDefs: defs })].flat(), 's')
    expect(after[0].style).toMatch(/^h/)
    expect(after[0].children?.[0].marks).toEqual(['k1'])
  })

  it('makes the title a heading that passes the save check even when the items start deeper', () => {
    const after = splitMinutes([block([['1. First item', ...EMPH], '\nBody text here.'])], 's')
    expect(checkContents([JSON.stringify(after)])).toEqual([])
    expect(after[0].style).toBe('h3')
  })

  it('is deterministic and gives each block its own key', () => {
    const before = [block(['One.\nTwo.\nThree.'])]
    const a = splitMinutes(before, 'x')
    expect(splitMinutes(before, 'x').map(b => b._key)).toEqual(a.map(b => b._key))
    expect(new Set(a.map(b => b._key)).size).toBe(3)
    expect(splitMinutes(before, 'y')[0]._key).not.toBe(a[0]._key)
  })

  it('passes other block types and list items through', () => {
    const image = { _key: 'i', _type: 'image' } as unknown as SanityBlock
    const list = block(['item'], { listItem: 'bullet', level: 1 })
    expect(splitMinutes([image, list], 's')).toEqual([image, list])
  })

  it('reports a change of words', () => {
    const before = [block(['one two'])]
    expect(sameText(before, [block(['one  two'])])).toBe(true)
    expect(sameText(before, [block(['one too'])])).toBe(false)
  })

  it('restructureMinutes gives the blocks, or the reason it will not', () => {
    const ok = restructureMinutes([block([['1. First item', ...EMPH], '\nBody text here.'])], 's')
    expect('sections' in ok && ok.sections.flat().length).toBe(2)
    expect(restructureMinutes([block(['Plain.'], { style: 'h2' }), block(['Next.'])], 's')).toHaveProperty('sections')
  })

  it('cuts a section at the title and at each numbered item, and keeps the rest with its item', () => {
    const h = (style: string, t: string) => block([t], { style })
    const sections = cutSections([
      block(['Preamble.']), h('h3', 'Title'), block(['Text before the list.']), h('h4', '1. One'), block(['a']), h('h4', 'Unnumbered'),
      block(['x']), h('h5', '(a) Sub'), block(['b']), h('h4', '2. Two'), block(['c']),
    ])
    expect(sections.map(s => s.length)).toEqual([1, 2, 6, 2])
    expect(sections[1][0].style).toBe('h3')
    expect(sections[3][0].style).toBe('h4')
  })

  it('keeps the outline valid across the sections', () => {
    const r = restructureMinutes([block([['1. First', ...EMPH], '\nBody.\n', ['2. Second', ...EMPH], '\nMore.'])], 's')
    expect('sections' in r && r.sections.length).toBe(2)
  })

  it('starts a section at a separator line, and a heading right after it joins that section', () => {
    const h = (style: string, t: string) => block([t], { style })
    const sections = cutSections([h('h3', 'Title'), block(['Body.']), block(['________________']), block(['TO: SN']), block(['----------------']), h('h3', 'Next'), block(['More.'])])
    expect(sections.map(s => s.length)).toEqual([2, 2, 3])
  })

  it('keeps everything before the first heading as one section, rules included', () => {
    const h = (style: string, t: string) => block([t], { style })
    const sections = cutSections([block(['Agenda.']), block(['________________']), block(['Memo header']), h('h3', 'Title'), block(['Body.'])])
    expect(sections.map(s => s.length)).toEqual([3, 2])
  })

  describe('applyCorrections', () => {
    const scan = [block(['4.\tN.N.I.U.\np.\tPolicy of future operations\nb.\tRole of W/T units'])]
    const fixes = [
      { key: 'ancc-24', from: '\np.\tPolicy', to: '\n5.\tPolicy' },
      { key: 'ancc-24', from: '\nb.\tRole', to: '\n6.\tRole' },
      { key: 'other', from: 'N.N.I.U.', to: 'NNIU' },
    ]

    it('applies the corrections of its own key, and says what they did', () => {
      const r = applyCorrections('ancc-24', scan, fixes)
      expect(r).toMatchObject({ applied: ['«p. Policy» → «5. Policy»', '«b. Role» → «6. Role»'] })
      expect('blocks' in r && r.blocks[0].children?.[0].text).toBe('4.\tN.N.I.U.\n5.\tPolicy of future operations\n6.\tRole of W/T units')
    })

    it('does not touch the input, and an entity with no corrections comes back as it was', () => {
      applyCorrections('ancc-24', scan, fixes)
      expect(scan[0].children?.[0].text).toContain('p.\tPolicy')
      expect(applyCorrections('ancc-99', scan, fixes)).toEqual({ blocks: scan, applied: [] })
    })

    it('refuses a correction that matches twice or not at all, and applies none', () => {
      const twice = [block(['a b a b'])]
      expect(applyCorrections('k', twice, [{ key: 'k', from: 'a', to: 'x' }])).toEqual({ error: 'correction «a» matches 2 times, not once' })
      expect(applyCorrections('k', twice, [{ key: 'k', from: 'zzz', to: 'x' }])).toEqual({ error: 'correction «zzz» matches 0 times, not once' })
    })

    it('feeds the same-words check: the corrected text is what the split is compared with', () => {
      const r = applyCorrections('ancc-24', scan, fixes)
      const corrected = 'blocks' in r ? r.blocks : []
      expect(sameText(corrected, splitMinutes(corrected, 's'))).toBe(true)
      expect(sameText(scan, splitMinutes(corrected, 's'))).toBe(false)
    })
  })
})
