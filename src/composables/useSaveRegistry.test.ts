import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createSaveRegistry, throwingSave } from './useSaveRegistry'
import type { SaveSection } from './useSaveRegistry'

function section(id: string, over: Partial<SaveSection> & { isDirty?: { value: boolean } } = {}) {
  const isDirty = over.isDirty ?? ref(true)
  const log: string[] = []
  const s: SaveSection = {
    id,
    label: id,
    dirty: () => isDirty.value,
    save: () => { log.push(`save:${id}`); isDirty.value = false; return Promise.resolve() },
    revert: () => { log.push(`revert:${id}`); isDirty.value = false },
    ...over,
  }
  return { s, isDirty, log }
}

describe('registry', () => {
  it('counts and lists only dirty sections, in registration order', () => {
    const r = createSaveRegistry()
    const a = section('a'); const b = section('b', { isDirty: ref(false) }); const c = section('c')
    r.register(a.s); r.register(b.s); r.register(c.s)
    expect(r.dirtyCount.value).toBe(2)
    expect(r.listed.value.map(s => s.id)).toEqual(['a', 'c'])
    expect(r.dirtyLabels.value).toEqual(['a', 'c'])
  })

  it('refuses a duplicate id and forgets a section when it unregisters', () => {
    const r = createSaveRegistry()
    const a = section('a')
    const stop = r.register(a.s)
    expect(() => r.register(section('a').s)).toThrow(/already registered/)
    stop()
    expect(r.sections.value).toHaveLength(0)
  })
})

describe('saveAll', () => {
  it('saves one at a time, in order', async () => {
    const r = createSaveRegistry()
    const order: string[] = []
    let active = 0; let maxActive = 0
    const mk = (id: string) => section(id, {
      save: async () => {
        active++; maxActive = Math.max(maxActive, active)
        await Promise.resolve()
        order.push(id)
        active--
      },
    }).s
    r.register(mk('a')); r.register(mk('b')); r.register(mk('c'))
    await r.saveAll()
    expect(order).toEqual(['a', 'b', 'c'])
    expect(maxActive).toBe(1)
  })

  it('marks the rest waiting while one works, then done', async () => {
    const r = createSaveRegistry()
    let release!: () => void
    const gate = new Promise<void>(res => { release = res })
    const a = section('a', { save: () => gate })
    const b = section('b')
    r.register(a.s); r.register(b.s)
    const p = r.saveAll()
    expect(r.statusOf('a').state).toBe('working')
    expect(r.statusOf('b').state).toBe('waiting')
    expect(r.saving.value).toBe(true)
    release()
    await p
    expect(r.statusOf('a').state).toBe('done')
    expect(r.statusOf('b').state).toBe('done')
    expect(r.saving.value).toBe(false)
  })

  it('times a section from when it starts', async () => {
    let t = 1000
    const r = createSaveRegistry(() => t)
    r.register(section('a', { save: () => { t = 1750; return Promise.resolve() } }).s)
    await r.saveAll()
    const st = r.statusOf('a')
    expect(st.finishedAt! - st.startedAt!).toBe(750)
  })

  it('a failure in the middle does not stop the others and keeps the server message', async () => {
    const r = createSaveRegistry()
    const a = section('a'); const c = section('c')
    const b = section('b', { save: () => Promise.reject(new Error('Ukjent rolle')) })
    r.register(a.s); r.register(b.s); r.register(c.s)
    await r.saveAll()
    expect(a.log).toEqual(['save:a'])
    expect(c.log).toEqual(['save:c'])
    expect(r.statusOf('b')).toMatchObject({ state: 'failed', error: 'Ukjent rolle' })
    expect(r.failedCount.value).toBe(1)
    // the failed one is still listed (it is still dirty), the finished ones stay until dismissed
    expect(r.listed.value.map(s => s.id)).toEqual(['a', 'b', 'c'])
    r.dismissDone()
    expect(r.listed.value.map(s => s.id)).toEqual(['b'])
  })

  it('keeps a failed section listed even if the editor reports it clean', async () => {
    const r = createSaveRegistry()
    const a = section('a', { save: () => Promise.reject(new Error('x')) })
    r.register(a.s)
    await r.saveAll()
    a.isDirty.value = false
    expect(r.listed.value.map(s => s.id)).toEqual(['a'])
  })

  it('retries only the failed section', async () => {
    const r = createSaveRegistry()
    let fail = true
    const a = section('a')
    const b = section('b', { save: () => { if (fail) return Promise.reject(new Error('nei')); b.isDirty.value = false; return Promise.resolve() } })
    r.register(a.s); r.register(b.s)
    await r.saveAll()
    fail = false
    a.isDirty.value = true // would be saved again by saveAll, but not by a retry of b
    await r.saveOne('b')
    expect(r.statusOf('b')).toMatchObject({ state: 'done', error: null })
    expect(a.log).toEqual(['save:a'])
  })

  it('joins a run in progress instead of starting a second', async () => {
    const r = createSaveRegistry()
    const save = vi.fn(() => Promise.resolve())
    r.register(section('a', { save }).s)
    await Promise.all([r.saveAll(), r.saveAll()])
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('skips a section that unregisters while it waits', async () => {
    const r = createSaveRegistry()
    let release!: () => void
    const gate = new Promise<void>(res => { release = res })
    const a = section('a', { save: () => gate })
    const b = section('b')
    r.register(a.s)
    const stopB = r.register(b.s)
    const p = r.saveAll()
    stopB()
    release()
    await p
    expect(b.log).toEqual([])
  })

  it('does nothing when nothing is dirty', async () => {
    const r = createSaveRegistry()
    const a = section('a', { isDirty: ref(false) })
    r.register(a.s)
    await r.saveAll()
    expect(a.log).toEqual([])
    expect(r.listed.value).toEqual([])
  })
})

describe('revert', () => {
  it('reverts one section and clears its status', async () => {
    const r = createSaveRegistry()
    const a = section('a', { save: () => Promise.reject(new Error('x')) }); const b = section('b')
    r.register(a.s); r.register(b.s)
    await r.saveAll()
    r.revert('a')
    expect(a.log).toEqual(['revert:a'])
    expect(r.statusOf('a').state).toBe('idle')
    expect(b.log).toEqual(['save:b'])
  })

  it('refuses while the section is saving', async () => {
    const r = createSaveRegistry()
    let release!: () => void
    const gate = new Promise<void>(res => { release = res })
    const a = section('a', { save: () => gate })
    r.register(a.s)
    const p = r.saveAll()
    r.revert('a')
    expect(a.log).toEqual([])
    release()
    await p
  })

  it('revertAll reverts dirty and failed sections', async () => {
    const r = createSaveRegistry()
    const a = section('a', { save: () => Promise.reject(new Error('x')) }); const b = section('b', { isDirty: ref(false) }); const c = section('c')
    r.register(a.s); r.register(b.s)
    await r.saveAll()
    r.register(c.s)
    r.revertAll()
    expect(a.log).toEqual(['revert:a'])
    expect(c.log).toEqual(['revert:c'])
    expect(b.log).toEqual([])
  })
})

describe('throwingSave', () => {
  it('turns an error the editor kept into a rejection', async () => {
    const error = ref<string | null>(null)
    const save = throwingSave(() => { error.value = 'HTTP 500'; return Promise.resolve() }, error)
    await expect(save()).rejects.toThrow('HTTP 500')
  })

  it('resolves when the editor left no error', async () => {
    const error = ref<string | null>(null)
    await expect(throwingSave(() => Promise.resolve(), error)()).resolves.toBeUndefined()
  })
})
