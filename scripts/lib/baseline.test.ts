import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadBaselineFile } from './baseline.ts'

const dirs: string[] = []
afterEach(() => { vi.restoreAllMocks(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

describe('loadBaselineFile', () => {
  it('returns the documents by _id when the file is there', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baseline-')); dirs.push(dir)
    const file = join(dir, 'docs.json')
    writeFileSync(file, JSON.stringify([{ _id: 'a', _updatedAt: '1' }, { _id: 'b', _updatedAt: '2' }]))
    const out = loadBaselineFile(file)
    expect([...out.keys()]).toEqual(['a', 'b'])
    expect(out.get('b')?._updatedAt).toBe('2')
  })

  it('returns an empty map, and says so, when the file is missing (CI has no data/)', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const out = loadBaselineFile('data/does-not-exist/sanity-person.json')
    expect(out.size).toBe(0)
    expect(err).toHaveBeenCalledOnce()
    expect(String(err.mock.calls[0][0])).toMatch(/No baseline file .*goes to review/)
  })
})
