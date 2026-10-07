import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BundleOp, EntityPayload } from './useProposalBundle.ts'

const blocks = (text: string) => JSON.stringify([{ _type: 'block', _key: 'k1', children: [{ _type: 'span', _key: 's', text }] }])

let payload: EntityPayload | null = null
vi.mock('./useProposalBundle.ts', () => ({
  useProposalBundle: () => ({
    load: () => Promise.resolve(),
    getEntityRef: (id: string) => (payload ? { entityId: id, status: 'pending', opSummary: [] } : null),
    getEntityPayload: () => payload,
  }),
}))

const loaded: string[] = []
vi.mock('./useEquipmentData.ts', async () => {
  const { ref } = await import('vue')
  return {
    useEquipmentData: () => {
      const equipment     = ref<unknown>(null)
      const savedSections = ref<unknown[]>([])
      return {
        equipment, savedSections,
        loadEquipment: (slug: string) => {
          loaded.push(slug)
          equipment.value = { slug, canonicalName: 'OLGA', type: 'radio', subtype: null, country: null, period: null }
          savedSections.value = [{ order: 1, content: blocks('Live.'), citations: [], sourcedFrom: null }]
          return Promise.resolve()
        },
        resetEquipment: () => { equipment.value = null; savedSections.value = [] },
      }
    },
  }
})

import { useProposalEquipmentData } from './useProposalEquipmentData.ts'

const make = (...ops: BundleOp[]): EntityPayload => ({
  entityId: 'EquipmentType:olga', ops,
  derivedFrom: { source: { site: 'https://a.example', path: '/equipment/olga' } }, source: 's', generatedAt: 'now',
})

describe('useProposalEquipmentData', () => {
  beforeEach(() => { loaded.length = 0; payload = null })

  it('lays a create-entity over nothing: the page shows the bundle, not Neo4j', async () => {
    payload = make({
      op: 'create-entity', kind: 'EquipmentType', slug: 'olga',
      props: { canonicalName: 'OLGA', type: 'radio', country: 'GB' },
      descriptions: [{ order: 1, content: blocks('Ny.') }],
    })
    const d = useProposalEquipmentData('b1', 'EquipmentType:olga')
    await d.loadEquipment()
    expect(loaded).toEqual([])
    expect(d.equipment.value).toEqual({ slug: 'olga', canonicalName: 'OLGA', type: 'radio', subtype: null, country: 'GB', period: null })
    expect(d.savedSections.value.map(s => s.content)).toEqual([blocks('Ny.')])
    expect(d._proposal.value.error).toBeNull()
  })

  it('lays a set-description over the live equipment', async () => {
    payload = make({ op: 'set-description', order: 1, expectedSha: 'x', content: blocks('Endret.') })
    const d = useProposalEquipmentData('b1', 'EquipmentType:olga')
    await d.loadEquipment()
    expect(loaded).toEqual(['olga'])
    expect(d.savedSections.value.map(s => s.content)).toEqual([blocks('Endret.')])
  })

  it('says so when the id is not an EquipmentType, or not in the bundle', async () => {
    payload = make({ op: 'create-entity', kind: 'EquipmentType', slug: 'olga', props: {} })
    const wrong = useProposalEquipmentData('b1', 'Unit:olga')
    await wrong.loadEquipment()
    expect(wrong._proposal.value.error).toMatch(/not an EquipmentType id/)

    payload = null
    const missing = useProposalEquipmentData('b1', 'EquipmentType:olga')
    await missing.loadEquipment()
    expect(missing._proposal.value.error).toMatch(/not found in bundle/)
  })
})
