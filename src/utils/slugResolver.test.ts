import { describe, expect, it } from 'vitest'
import { resolveSlug, slugKey, zeroVariants, type QueryFn } from './slugResolver.ts'

/** A pretend database: it answers the resolver's query the way Neo4j would. */
function db(nodes: { label: string; slug: string }[]): QueryFn {
  const flat = (s: string) => s.toLowerCase().replace(/[-_. /]/g, '')
  return (_cypher, params) => {
    const { exact, keys } = params as { exact: string; keys: string[] }
    return Promise.resolve(nodes.filter(n => n.slug === exact || keys.includes(flat(n.slug))))
  }
}

const NODES = [
  { label: 'Operation', slug: 'sub004' },
  { label: 'Operation', slug: 'mtb-x37' },
  { label: 'Operation', slug: 'ax-13' },
  { label: 'Operation', slug: 'ax-45-1' },
  { label: 'Operation', slug: 'East BOAC/BALDER-040445' },
  { label: 'Person', slug: 'john-rognes' },
  { label: 'Transport', slug: 'hms-rodney' },
  { label: 'Operation', slug: 'boac-2' },
  { label: 'Operation', slug: 'boac-02' },
]

describe('slugKey', () => {
  it('ignores capitals, punctuation and leading zeros after a letter', () => {
    expect(slugKey('AX-013')).toBe('ax13')
    expect(slugKey('ax13')).toBe('ax13')
    expect(slugKey('ax-13')).toBe('ax13')
    expect(slugKey('mtb-x037 ')).toBe('mtbx37')
    expect(slugKey('SUB004')).toBe('sub4')
    expect(slugKey('ax-45-1')).toBe('ax451')
  })

  it('keeps a zero that is not after a letter', () => {
    expect(slugKey('boac-120')).toBe('boac120')
    expect(slugKey('ancc-10')).toBe('ancc10')
  })
})

describe('zeroVariants', () => {
  it('lists the key with up to three zeros after the letters', () => {
    expect(zeroVariants('ax13')).toEqual(['ax13', 'ax013', 'ax0013', 'ax00013'])
  })

  it('is just the key when there is no letter before a digit', () => {
    expect(zeroVariants('13')).toEqual(['13'])
    expect(zeroVariants('abc')).toEqual(['abc'])
  })

  it('gives up on a key with many boundaries instead of listing thousands', () => {
    expect(zeroVariants('a1b2c3d4')).toEqual(['a1b2c3d4'])
  })
})

describe('resolveSlug', () => {
  const run = (slug: string) => resolveSlug(slug, db(NODES))

  it('finds a slug that is a person or a vessel and not an event', async () => {
    expect(await run('john-rognes')).toEqual({ path: '/person/john-rognes', label: 'Person', slug: 'john-rognes' })
    expect(await run('hms-rodney')).toMatchObject({ path: '/transport/hms-rodney' })
  })

  it('finds an event written with other capitals, zeros or hyphens', async () => {
    expect(await run('SUB004')).toMatchObject({ path: '/events/sub004' })
    expect(await run('mtb-x037')).toMatchObject({ path: '/events/mtb-x37' })
    expect(await run('mtb-x037 ')).toMatchObject({ path: '/events/mtb-x37' })
    expect(await run('ax13')).toMatchObject({ path: '/events/ax-13' })
    expect(await run('ax-045-1')).toMatchObject({ path: '/events/ax-45-1' })
  })

  it('encodes a slug that has a space and a slash', async () => {
    expect(await run('east boac/balder-040445')).toMatchObject({ path: '/events/East%20BOAC%2FBALDER-040445' })
  })

  it('prefers the exact slug over a spelling match', async () => {
    expect(await run('boac-2')).toMatchObject({ path: '/events/boac-2' })
  })

  it('says nothing when two pages fit equally well', async () => {
    expect(await run('boac-002')).toBeNull()   // boac-2 and boac-02 both fit
  })

  it('says nothing when no page fits', async () => {
    expect(await run('soe-station-thrush')).toBeNull()
    expect(await run('Leaflets No 23-45')).toBeNull()
  })

  it('says nothing for a slug with nothing to compare', async () => {
    expect(await run('---')).toBeNull()
    expect(await run('')).toBeNull()
  })
})
