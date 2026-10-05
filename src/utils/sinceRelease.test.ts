import { describe, expect, it } from 'vitest'
import { commitUrl, isHousekeeping, parseCommitLog } from './sinceRelease'

describe('parseCommitLog', () => {
  it('reads hash and subject per line', () => {
    expect(parseCommitLog('abc1234\tfeat(x): one\ndef5678\tfix: two: with colon\n')).toEqual([
      { hash: 'abc1234', subject: 'feat(x): one' },
      { hash: 'def5678', subject: 'fix: two: with colon' },
    ])
  })

  it('is empty when nothing follows the tag', () => {
    expect(parseCommitLog('')).toEqual([])
  })
})

describe('commitUrl', () => {
  it('points at the commit on GitHub', () => {
    expect(commitUrl('o/r', 'abc1234')).toBe('https://github.com/o/r/commit/abc1234')
  })
})

describe('isHousekeeping', () => {
  it('hides chore, ci, build, docs, test and refactor, with or without scope or bang', () => {
    for (const s of ['chore: release 0.2.0', 'chore(deps): bump x', 'ci(sync): keep the plans', 'ci!: drop node 20', 'docs: readme', 'test(auth): cover x', 'refactor(map): split', 'build(deps): bump x']) {
      expect(isHousekeeping(s)).toBe(true)
    }
  })

  it('keeps everything else', () => {
    for (const s of ['feat(sync): stamp', 'fix: a chore: inside', 'style: spacing', 'feat!: x', 'Merge branch main']) {
      expect(isHousekeeping(s)).toBe(false)
    }
  })
})
