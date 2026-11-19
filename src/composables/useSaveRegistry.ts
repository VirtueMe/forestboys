/**
 * useSaveRegistry — the page owns one save row; each editor on it registers
 * what it needs the row to know (#427).
 *
 *   page:    const registry = provideSaveRegistry()
 *   editor:  useSaveSection({ label, dirty, save, revert })
 *
 * The editors keep their own endpoints and draft logic. What moves here is the
 * button and the status: *that* the editor is dirty, a label, how to save and
 * how to revert.
 *
 * Contract for `save()`: resolve when saved, **reject** with an Error whose
 * message is shown to the user when it fails. An editor that catches its own
 * error and returns normally would be reported as done.
 *
 * #428 adds an optional `changes()` to a section (one line per change); the
 * registry passes sections through untouched, so nothing here needs to change.
 */
import { computed, inject, isRef, onScopeDispose, provide, reactive, shallowRef } from 'vue'
import type { InjectionKey, Ref } from 'vue'

export type SectionState = 'idle' | 'waiting' | 'working' | 'done' | 'failed'

export interface SaveSection {
  /** Unique on the page; also the registration key. */
  id:     string
  /** Shown in the drop-up: «Grunnleggende», «Beskrivelse», … */
  label:  string
  dirty:  () => boolean
  save:   () => Promise<void>
  revert: () => void
  /**
   * Changes whenever the editor's content changes. A section that failed to save goes back to
   * «unsaved» when it does, so the row does not keep reporting a failure the user has since fixed.
   * Without it a failure stays until the next save or «Angre».
   */
  signature?: () => string
}

/** What an editor passes in: `dirty` may be a ref or a getter. */
export interface SaveSectionInput extends Omit<SaveSection, 'dirty'> {
  dirty: Ref<boolean> | (() => boolean)
}

export interface SectionStatus {
  state:      SectionState
  /** The server's message when `state` is 'failed'. */
  error:      string | null
  /** Set when the section starts working; the row shows a timer from it. */
  startedAt:  number | null
  finishedAt: number | null
  /** The section's `signature()` when it failed. */
  failedAt:   string | null
}

const idleStatus = (): SectionStatus => ({ state: 'idle', error: null, startedAt: null, finishedAt: null, failedAt: null })

export function createSaveRegistry(now: () => number = Date.now) {
  // Registration order is save order.
  const sections = shallowRef<SaveSection[]>([])
  const status   = reactive(new Map<string, SectionStatus>())
  let running: Promise<void> | null = null

  function statusOf(id: string): SectionStatus {
    const st = status.get(id)
    if (!st) return idleStatus()
    // A failure is about the content that was saved; once that has changed it no longer applies.
    if (st.state === 'failed' && st.failedAt !== null) {
      const sig = sections.value.find(s => s.id === id)?.signature
      if (sig && sig() !== st.failedAt) return idleStatus()
    }
    return st
  }

  function setStatus(id: string, patch: Partial<SectionStatus>) {
    status.set(id, { ...statusOf(id), ...patch })
  }

  /** Returns the function that removes the section again. */
  function register(section: SaveSection): () => void {
    if (sections.value.some(s => s.id === section.id)) {
      throw new Error(`Save section already registered: ${section.id}`)
    }
    sections.value = [...sections.value, section]
    return () => {
      sections.value = sections.value.filter(s => s !== section)
      status.delete(section.id)
    }
  }

  /** Sections shown in the drop-up: unsaved, or still reporting a save. */
  const listed = computed(() => sections.value.filter(s => s.dirty() || statusOf(s.id).state !== 'idle'))
  const dirtySections = computed(() => sections.value.filter(s => s.dirty()))
  const dirtyCount    = computed(() => dirtySections.value.length)
  const dirtyLabels   = computed(() => dirtySections.value.map(s => s.label))
  const failedCount   = computed(() => sections.value.filter(s => statusOf(s.id).state === 'failed').length)
  const saving        = computed(() => sections.value.some(s => {
    const st = statusOf(s.id).state
    return st === 'waiting' || st === 'working'
  }))

  async function runOne(section: SaveSection): Promise<void> {
    setStatus(section.id, { state: 'working', error: null, startedAt: now(), finishedAt: null })
    try {
      await section.save()
      if (sections.value.includes(section)) setStatus(section.id, { state: 'done', finishedAt: now() })
    } catch (err) {
      if (sections.value.includes(section)) {
        setStatus(section.id, {
          state: 'failed', error: err instanceof Error ? err.message : String(err), finishedAt: now(),
          failedAt: section.signature?.() ?? null,
        })
      }
    }
  }

  async function runSequence(targets: SaveSection[]): Promise<void> {
    for (const s of targets) setStatus(s.id, { ...idleStatus(), state: 'waiting' })
    for (const s of targets) {
      // Removed while waiting (the editor went away): nothing to save.
      if (!sections.value.includes(s)) continue
      await runOne(s)
    }
  }

  /** Run `targets` one at a time. A call during a run joins it instead of starting a second. */
  function start(targets: SaveSection[]): Promise<void> {
    if (running) return running
    if (!targets.length) return Promise.resolve()
    running = runSequence(targets).finally(() => { running = null })
    return running
  }

  /** «Lagre alt»: every dirty section, in registration order. A failure does not stop the rest. */
  function saveAll(): Promise<void> {
    return start(dirtySections.value)
  }

  /** Retry, or save, one section on its own. */
  function saveOne(id: string): Promise<void> {
    const s = sections.value.find(x => x.id === id)
    return s ? start([s]) : Promise.resolve()
  }

  /** «Angre» on one section. Not while it is saving. */
  function revert(id: string): void {
    const s = sections.value.find(x => x.id === id)
    if (!s) return
    const st = statusOf(id).state
    if (st === 'waiting' || st === 'working') return
    s.revert()
    status.delete(id)
  }

  function revertAll(): void {
    const ids = new Set([...dirtySections.value, ...sections.value.filter(x => statusOf(x.id).state === 'failed')].map(s => s.id))
    for (const id of ids) revert(id)
  }

  /** Forget finished sections so the drop-up empties; failed ones stay. */
  function dismissDone(): void {
    for (const [id, st] of [...status]) if (st.state === 'done') status.delete(id)
  }

  return {
    sections, listed, dirtySections, dirtyCount, dirtyLabels, failedCount, saving,
    statusOf, register, saveAll, saveOne, revert, revertAll, dismissDone,
  }
}

export type SaveRegistry = ReturnType<typeof createSaveRegistry>

/**
 * For an editor whose own `save()` catches its errors into an `error` ref and
 * returns: rejects with that message, so the registry sees the failure.
 */
export function throwingSave(save: () => Promise<void>, error: Ref<string | null>): () => Promise<void> {
  return async () => {
    await save()
    if (error.value) throw new Error(error.value)
  }
}

const SaveRegistryKey: InjectionKey<SaveRegistry> = Symbol('saveRegistry')

/** The page calls this once; editors below it find the registry. */
export function provideSaveRegistry(): SaveRegistry {
  const registry = createSaveRegistry()
  provide(SaveRegistryKey, registry)
  return registry
}

/** Null where no page provides one (create mode, previews): the editor keeps its own save bar. */
export function useSaveRegistry(): SaveRegistry | null {
  return inject(SaveRegistryKey, null)
}

/**
 * An editor calls this in setup. Returns false when there is no registry, so
 * the editor knows to keep rendering its own save bar.
 */
export function useSaveSection(input: SaveSectionInput): boolean {
  const registry = useSaveRegistry()
  if (!registry) return false
  const dirty = input.dirty
  const stop = registry.register({
    id: input.id,
    get label() { return input.label },
    dirty: isRef(dirty) ? () => dirty.value : dirty,
    save: input.save,
    revert: input.revert,
    signature: input.signature,
  })
  onScopeDispose(stop)
  return true
}
