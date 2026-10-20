import { describe, expect, it } from 'vitest'
import { checkContainer, checkContentContainers, checkTopLevelBlock, isContainerType } from './description-blocks.ts'

const text = (key: string, over: Record<string, unknown> = {}) => ({ _type: 'block', _key: key, style: 'normal', markDefs: [], children: [{ _type: 'span', _key: `${key}s`, text: key, marks: [] }], ...over })
const cell = (key: string, ...content: unknown[]) => ({ _type: 'cell', _key: key, content })
const row = (key: string, ...cells: unknown[]) => ({ _type: 'row', _key: key, cells })
const table = (key: string, rows: unknown[], over: Record<string, unknown> = {}) => ({ _type: 'table', _key: key, rows, ...over })
const box = (key: string, ...content: unknown[]) => ({ _type: 'infoBox', _key: key, content })
const okTable = () => table('t', [row('r', cell('c1', text('a')), cell('c2', text('b'), text('c')))])

describe('isContainerType', () => {
  it('knows the box and the table, and nothing else', () => {
    expect(isContainerType('infoBox')).toBe(true)
    expect(isContainerType('table')).toBe(true)
    for (const t of ['block', 'row', 'cell', 'columns', 'image', undefined, 7]) expect(isContainerType(t)).toBe(false)
  })
})

describe('checkTopLevelBlock', () => {
  it('takes a text block, a box, a table, and a table inside a box', () => {
    expect(checkTopLevelBlock(text('a'), 'v')).toBeNull()
    expect(checkTopLevelBlock(box('b', text('x')), 'v')).toBeNull()
    expect(checkTopLevelBlock(okTable(), 'v')).toBeNull()
    expect(checkTopLevelBlock(box('b', text('x'), okTable(), text('y')), 'v')).toBeNull()
  })

  it('takes the options of a table, and none', () => {
    expect(checkTopLevelBlock(table('t', [row('r', cell('c', text('a')))], { frame: 'around', rowLines: true, columnLines: false }), 'v')).toBeNull()
    expect(checkTopLevelBlock(table('t', [row('r', cell('c', text('a')))], { frame: 'none' }), 'v')).toBeNull()
    expect(checkTopLevelBlock(table('t', [row('r', cell('c', text('a')))], { width: 'full' }), 'v')).toBeNull()
    expect(checkTopLevelBlock(table('t', [row('r', cell('c', text('a')))], { width: 'compact' }), 'v')).toBeNull()
  })

  it('refuses a width that is neither compact nor full', () => {
    expect(checkTopLevelBlock(table('t', [row('r', cell('c', text('a')))], { width: 'wide' }), 'v')).toContain('width must be one of compact, full')
  })

  it('takes a cell with no blocks, and a text block in a cell that is a list item or a quote', () => {
    expect(checkTopLevelBlock(table('t', [row('r', cell('c'))]), 'v')).toBeNull()
    expect(checkTopLevelBlock(table('t', [row('r', cell('c', text('a', { listItem: 'bullet', level: 1 }), text('b', { style: 'blockquote' })))]), 'v')).toBeNull()
  })

  it('refuses what is neither a text block nor a known container, saying what is accepted', () => {
    expect(checkTopLevelBlock({ _type: 'columns', _key: 'k' }, 'v')).toContain('infoBox, table')
    expect(checkTopLevelBlock({ _type: 'image', _key: 'i' }, 'v')).toContain('must be a text block')
    expect(checkTopLevelBlock({ _type: 'block', _key: 'b' }, 'v')).toContain('children[]')
    expect(checkTopLevelBlock(null, 'v')).toContain('must be a text block')
    expect(checkTopLevelBlock('text', 'v')).toContain('must be a text block')
  })
})

describe('checkContainer: the table', () => {
  it.each([
    ['no rows', table('t', []), 'rows[] needs at least 1'],
    ['rows that are not a list', { _type: 'table', _key: 't', rows: 'x' }, 'rows[] required'],
    ['a row that is not a row', table('t', [{ _type: 'cell', _key: 'x', content: [] }]), 'must be a row'],
    ['a row with no cells', table('t', [row('r')]), 'cells[] needs at least 1'],
    ['a cell that is not a cell', table('t', [row('r', text('a'))]), 'must be a cell'],
    ['a cell whose content is not a list', table('t', [row('r', { _type: 'cell', _key: 'c', content: 'x' })]), 'content[] required'],
    ['a box in a cell', table('t', [row('r', cell('c', box('b', text('a'))))]), 'must be a text block'],
    ['a table in a cell', table('t', [row('r', cell('c', okTable()))]), 'must be a text block'],
    ['a block in a cell with no children', table('t', [row('r', cell('c', { _type: 'block', _key: 'x' }))]), 'children[] required'],
    ['a block in a cell with no key', table('t', [row('r', cell('c', { _type: 'block', children: [] }))]), '_key required'],
    ['a table with no key', { _type: 'table', rows: [row('r', cell('c', text('a')))] }, '_key required'],
    ['a row with no key', table('t', [{ _type: 'row', cells: [cell('c')] }]), '_key required'],
    ['a cell with no key', table('t', [row('r', { _type: 'cell', content: [] })]), '_key required'],
    ['an unknown frame', table('t', [row('r', cell('c', text('a')))], { frame: 'dotted' }), 'frame must be one of none, topBottom, around'],
    ['rowLines that is not a boolean', table('t', [row('r', cell('c', text('a')))], { rowLines: 'yes' }), 'rowLines must be true or false'],
    ['columnLines that is not a boolean', table('t', [row('r', cell('c', text('a')))], { columnLines: 1 }), 'columnLines must be true or false'],
  ])('refuses %s', (_name, node, reason) => {
    expect(checkContainer(node, 'v')).toContain(reason)
  })

  it('refuses a heading in a cell, in any heading style, and says so', () => {
    for (const h of ['h1', 'h3', 'h6']) {
      expect(checkContainer(table('t', [row('r', cell('c', text('a', { style: h })))]), 'v')).toContain(`a table cell holds no headings (style "${h}")`)
    }
  })

  it('names where the fault is', () => {
    expect(checkContainer(table('t', [row('r', cell('c1', text('a')), cell('c2', { _type: 'block', _key: 'x' }))]), 'v')).toBe('v.rows[0].cells[1].content[0]: children[] required')
  })
})

describe('checkContainer: the box', () => {
  it('holds text blocks and tables, headings included', () => {
    expect(checkContainer(box('b', text('h', { style: 'h3' }), okTable()), 'v')).toBeNull()
    expect(checkContainer(box('b'), 'v')).toBeNull()
  })

  it('refuses a box in a box, a row or a cell on its own, and a block with no children', () => {
    expect(checkContainer(box('b', box('c', text('a'))), 'v')).toContain('must be a text block')
    expect(checkContainer(box('b', row('r')), 'v')).toContain('must be a text block')
    expect(checkContainer(box('b', { _type: 'block', _key: 'x' }), 'v')).toContain('children[] required')
    expect(checkContainer({ _type: 'infoBox', content: [] }, 'v')).toContain('_key required')
    expect(checkContainer({ _type: 'infoBox', _key: 'b' }, 'v')).toContain('content[] required')
  })

  it('judges a table inside a box as a table', () => {
    expect(checkContainer(box('b', table('t', [])), 'v')).toContain('rows[] needs at least 1')
  })
})

describe('checkContentContainers: a description as the JSON a bundle carries', () => {
  it('passes plain blocks, unknown top-level types, and well-formed containers', () => {
    expect(checkContentContainers(JSON.stringify([text('a'), { _type: 'image', _key: 'i' }, box('b', text('x')), okTable()]), 'c')).toBeNull()
  })

  it('refuses a malformed container, naming its place in the list', () => {
    expect(checkContentContainers(JSON.stringify([text('a'), table('t', [])]), 'c')).toBe('c[1]: rows[] needs at least 1')
  })

  it('leaves not-JSON and not-a-list to the caller', () => {
    expect(checkContentContainers('nope', 'c')).toBeNull()
    expect(checkContentContainers('{"a":1}', 'c')).toBeNull()
  })
})
