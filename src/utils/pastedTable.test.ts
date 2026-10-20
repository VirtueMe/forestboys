import { describe, expect, it } from 'vitest'
import { tableFromTabs } from './pastedTable.ts'
import { cellTexts } from './textTable.ts'

const counter = () => { let n = 0; return () => `k${++n}` }

describe('tableFromTabs', () => {
  it('makes a table of the rows Excel puts on the clipboard, with its line ends and its last line break', () => {
    const t = tableFromTabs('Navn\tBy\r\nEva\tBergen\r\nMartin\tOslo\r\n', counter())!
    expect(cellTexts(t)).toEqual([['Navn', 'By'], ['Eva', 'Bergen'], ['Martin', 'Oslo']])
  })

  it('keeps an empty cell between two tabs', () => {
    expect(cellTexts(tableFromTabs('a\t\tc\nd\te\tf', counter())!)).toEqual([['a', '', 'c'], ['d', 'e', 'f']])
  })

  it('leaves one line alone, even with a tab in it: a tab can be only a tab', () => {
    expect(tableFromTabs('a\tb', counter())).toBeNull()
    expect(tableFromTabs('a\tb\n', counter())).toBeNull()
  })

  it('leaves text without tabs alone, and text where only a few lines have one', () => {
    expect(tableFromTabs('one\ntwo\nthree', counter())).toBeNull()
    expect(tableFromTabs('a\tb\nprose\nmore prose\neven more', counter())).toBeNull()
  })

  it('leaves text alone where the lines have tabs only at the edges, which makes no second column', () => {
    expect(tableFromTabs('a\t\nb\t', counter())).toBeNull()
  })
})
