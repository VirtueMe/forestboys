import { describe, expect, it } from 'vitest'
import {
  KINDS, classifyDescription, descriptionId, graphValue, hasText, importedBlocks, sanityValue, stampsFor, type GraphDescription,
} from './description-sync.ts'
import { sha, type Doc } from './person-sync.ts'
import { stableJson } from './sanity-sha.ts'

const transport = KINDS.transport

const block = (text: string) => ({ _key: 'b1', _type: 'block', markDefs: [], children: [{ _key: 's1', _type: 'span', marks: [], text }] })
const doc = (description: unknown, over: Record<string, unknown> = {}): Doc =>
  ({ _id: 't1', _updatedAt: '2026-10-05T10:00:00Z', description, ...over })

const graph = (over: Partial<GraphDescription> = {}): GraphDescription =>
  ({ sanityId: 't1', slug: 'nona-rhea', stamp: undefined, content: null, ...over })
const stored = (blocks: unknown) => JSON.stringify(blocks)
const stampOf = (d: Doc) => sha(sanityValue(d))

describe('hasText', () => {
  it('needs a non-blank span', () => {
    expect(hasText([block('Transferred in Dec 44')])).toBe(true)
    expect(hasText([block('   ')])).toBe(false)
    expect(hasText([])).toBe(false)
    expect(hasText(undefined)).toBe(false)
    expect(hasText('text')).toBe(false)
  })
})

describe('what is compared and stamped', () => {
  it('is empty when Sanity has no text', () => {
    expect(sanityValue(doc(undefined))).toBe('')
    expect(sanityValue(doc([block('')]))).toBe('')
    expect(importedBlocks(doc([block('')]))).toBeNull()
  })

  it('makes AIR 27 references links, as for events (#106)', () => {
    const blocks = importedBlocks(doc([block('Se AIR-27-2159-22 p24')]))!
    expect(JSON.stringify(blocks)).toContain('discovery.nationalarchives.gov.uk')
    expect(sanityValue(doc([block('Se AIR-27-2159-22 p24')]))).toBe(stableJson(blocks))
  })

  it('is the same however the graph spells the JSON', () => {
    const d = doc([block('Nona Rhea')])
    const reordered = JSON.stringify(JSON.parse(JSON.stringify(importedBlocks(d))), null, 1)
    expect(graphValue(reordered)).toBe(sanityValue(d))
  })

  it('reads no content, and a description with no text, as empty', () => {
    expect(graphValue(null)).toBe('')
    expect(graphValue(stored([block('')]))).toBe('')
  })
})

describe('classifyDescription', () => {
  const d = doc([block('Nona Rhea, ex 446 BG')])
  const text = importedBlocks(d)

  it('imports text that is in Sanity and nowhere in the graph', () => {
    expect(classifyDescription(graph(), d)).toBe('new')
  })

  it('does nothing when neither side has text', () => {
    expect(classifyDescription(graph(), doc(undefined))).toBe('unchanged')
    expect(classifyDescription(graph({ stamp: sha('') }), doc(undefined))).toBe('unchanged')
  })

  it('leaves text the graph already has, with no stamp, for review — never overwrites it', () => {
    expect(classifyDescription(graph({ content: stored([block('Skrevet i grafen')]) }), d)).toBe('review')
  })

  it('only stamps text the graph already has that equals Sanity', () => {
    expect(classifyDescription(graph({ content: stored(text) }), d)).toBe('already')
  })

  it('does nothing while Sanity is unchanged since the stamp, whatever the graph holds', () => {
    expect(classifyDescription(graph({ stamp: stampOf(d), content: stored(text) }), d)).toBe('unchanged')
    expect(classifyDescription(graph({ stamp: stampOf(d), content: stored([block('Rettet i grafen')]) }), d)).toBe('unchanged')
    expect(classifyDescription(graph({ stamp: stampOf(d), content: null }), d)).toBe('unchanged')
  })

  describe('after Sanity changed', () => {
    const before = doc([block('Gammel tekst')])
    const after = doc([block('Ny tekst')])

    it('applies it when the graph still holds the stamped text (clean)', () => {
      expect(classifyDescription(graph({ stamp: stampOf(before), content: stored(importedBlocks(before)) }), after)).toBe('clean')
    })

    it('only moves the stamp when the graph already holds the new text', () => {
      expect(classifyDescription(graph({ stamp: stampOf(before), content: stored(importedBlocks(after)) }), after)).toBe('already')
    })

    it('is a conflict when the graph text was edited, or taken away', () => {
      expect(classifyDescription(graph({ stamp: stampOf(before), content: stored([block('Rettet i grafen')]) }), after)).toBe('conflict')
      expect(classifyDescription(graph({ stamp: stampOf(before), content: null }), after)).toBe('conflict')
    })

    it('removes the text when Sanity emptied it and the graph is still as stamped', () => {
      expect(classifyDescription(graph({ stamp: stampOf(before), content: stored(importedBlocks(before)) }), doc(undefined))).toBe('clean')
    })
  })

  it('is clean for a node stamped before AIR 27 references were linked: the linked text is a change Sanity did not make, and the graph is untouched', () => {
    const withRef = doc([block('Se AIR-27-2159-22 p24')])
    const oldStamp = sha(stableJson(withRef.description))
    expect(classifyDescription(graph({ stamp: oldStamp, content: stored(withRef.description) }), withRef)).toBe('clean')
  })
})

describe('the types it covers', () => {
  it.each(['transport', 'station', 'location'])('%s: the graph label, the Sanity type and the id the editor uses', key => {
    const kind = KINDS[key]
    expect(kind.key).toBe(key)
    expect(kind.sanityType).toBe(key)
    expect(kind.label).toBe(key[0].toUpperCase() + key.slice(1))
    expect(descriptionId(kind, 'x')).toBe(`desc:${key}:x:1`)
    expect(stampsFor(kind, doc([block('x')])).description_sourceRef).toBe(`sanity-migration:${key}:t1:description`)
  })
})

describe('stamps and ids', () => {
  it('records the hash, where it came from and when, as the person import does', () => {
    const d = doc([block('Nona Rhea')])
    expect(stampsFor(transport, d)).toEqual({
      description_sha: sha(sanityValue(d)),
      description_sourceRef: 'sanity-migration:transport:t1:description',
      description_state: 'candidate',
      description_sanityUpdatedAt: '2026-10-05T10:00:00Z',
    })
  })

  it('names the order-1 description as the editor does', () => {
    expect(descriptionId(transport, 'nona-rhea')).toBe('desc:transport:nona-rhea:1')
  })
})

describe('the tables are marked on the way in (#260)', () => {
  const table = { _key: 't', _type: 'block', style: 'normal', markDefs: [], children: [{ _key: 's', _type: 'span', marks: [], text: '1.\tOne' }] }

  it('marks a tab block in what a sync takes in, and leaves the rest', () => {
    const got = importedBlocks(doc([block('Prose.'), table])) as { style?: string }[]
    expect(got.map(b => b.style)).toEqual([undefined, 'preformatted'])
  })

  it('reads a graph already migrated as the import, not as an edit', () => {
    const d = doc([table])
    const migrated = JSON.stringify([{ ...table, style: 'preformatted' }])
    expect(graphValue(migrated)).toBe(sanityValue(d))
    expect(classifyDescription({ sanityId: 'x', slug: 's', stamp: stampOf(doc([block('old')])), content: migrated }, d)).toBe('already')
  })
})

describe('outlines (#301)', () => {
  const outline = KINDS.outline
  const text = (t: string) => [block(t)]
  const d = (t: string, at = '2026-10-05T10:00:00Z') => doc(text(t), { _id: 'o1', _updatedAt: at })
  const g = (t: string, over: Partial<GraphDescription> = {}) => graph({ sanityId: 'o1', slug: 'olga', content: stored(text(t)), ...over })

  it('keeps the id the import gave a Description, and takes the blocks as they are', () => {
    expect(descriptionId(outline, 'olga')).toBe('desc:Outline:olga:1')
    const ref = block('Se AIR-27-2159-22 p24')
    expect(sanityValue(doc([ref]), outline)).toBe(stableJson(importedBlocks(doc([ref]), outline)))
    expect(stableJson(importedBlocks(doc([ref]), outline))).not.toBe(stableJson(importedBlocks(doc([ref]))))
  })

  it('takes Sanity\'s change when the graph still holds the baseline\'s text', () => {
    expect(classifyDescription(g('before'), d('after'), outline, d('before', '2026-04-01T00:00:00Z'))).toBe('clean')
  })

  it('holds a graph text that is neither the baseline\'s nor Sanity\'s', () => {
    expect(classifyDescription(g('edited'), d('after'), outline, d('before', '2026-04-01T00:00:00Z'))).toBe('conflict')
  })

  it('sends a differing text to review when there is no baseline', () => {
    expect(classifyDescription(g('before'), d('after'), outline)).toBe('review')
  })

  it('finds the graph already right without looking at the baseline', () => {
    expect(classifyDescription(g('same'), d('same'), outline, d('older', '2026-04-01T00:00:00Z'))).toBe('already')
  })

  it('leaves the Linge members outline alone', () => {
    expect(outline.skip?.has('917b8cb9-6a12-4a96-91eb-8444691d6797')).toBe(true)
  })
})
