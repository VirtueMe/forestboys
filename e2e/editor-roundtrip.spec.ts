import { expect, test } from '@playwright/test'
import { blocksOf, caretAtEndOf, openEditor, reportedTexts } from './helpers/editor.ts'
import { fixtures } from './harness/fixtures.ts'
import type { Block } from './harness/types.ts'

/** A block without its keys, which the editor may renumber: what it says and how it is marked. */
const shape = (b: Block) => ({
  style: b.style ?? 'normal',
  listItem: b.listItem ?? null,
  level: b.listItem ? (b.level ?? 1) : null,
  markDefs: (b.markDefs ?? []).map(({ _key, _type, ...rest }) => ({ _key, _type, ...rest })),
  children: (b.children ?? []).map(c => ({ text: c.text, marks: c.marks ?? [] })),
})

// What is stored goes into the editor and comes out the same (#124): lists, levels, headings, links and
// person marks are not lost or rewritten by an edit somewhere else in the text.
test.describe('the round-trip', () => {
  for (const [fixture, anchor] of [
    ['lists', 'Et avsnitt etter listen.'],
    ['links', '.'],
    ['headings', 'Tekst under overskriftene.'],
  ] as const) {
    test(`«${fixture}»: an edit at the end changes that text and nothing else`, async ({ page }) => {
      await openEditor(page, fixture)
      const start = fixtures[fixture]
      await caretAtEndOf(page, anchor)
      await page.keyboard.type('!')
      await expect.poll(async () => (await reportedTexts(page)).join('').endsWith('!')).toBe(true)

      const expected = start.map(shape)
      const last = expected[expected.length - 1].children
      last[last.length - 1] = { ...last[last.length - 1], text: last[last.length - 1].text + '!' }
      expect((await blocksOf(page)).map(shape)).toEqual(expected)
    })
  }
})
