<template>
  <section ref="root" class="edit-section photo-editor">
    <div class="edit-section-head">
      <h2 class="edit-section-heading">
        Bilder
        <span v-if="images.length" class="edit-section-count" :aria-label="`${images.length} bilder`">{{ images.length }}</span>
      </h2>
      <button
        v-if="collapsible"
        type="button"
        class="list-toggle"
        :aria-expanded="showAll"
        :aria-controls="listId"
        @click="showAll = !showAll"
      >
        {{ showAll ? 'Vis færre' : `Vis alle ${images.length}` }}
      </button>
    </div>

    <div v-if="loading" class="photo-empty">Laster bilder…</div>
    <div v-else-if="!images.length" class="photo-empty">Ingen egne bilder ennå.</div>
    <div
      v-else
      :id="listId"
      class="list-scroll"
      :class="{ collapsed }"
      :style="collapsed && clipHeight ? { maxHeight: `${clipHeight + 4}px` } : undefined"
      :tabindex="collapsed ? 0 : undefined"
      :role="collapsed ? 'region' : undefined"
      :aria-label="collapsed ? 'Bilder, rullbar liste' : undefined"
    >
      <ul ref="listEl" class="photo-list">
        <li v-for="(img, i) in images" :key="img.id" class="photo-row" :class="{ moving: movingId === img.id }">
          <img class="photo-thumb" :src="`${img.url}?w=400`" alt="" loading="lazy" />
          <div class="photo-body">
            <input
              class="photo-caption"
              type="text"
              :value="img.caption ?? ''"
              placeholder="Bildetekst"
              :aria-label="`Bildetekst for bilde ${i + 1}`"
              @change="e => setCaption(img, (e.target as HTMLInputElement).value)"
            />
            <div class="photo-actions">
              <span class="photo-pos">{{ i + 1 }}<span v-if="img.isHero" class="photo-hero-tag"> · Hovedbilde</span></span>
              <div v-if="images.length > 1" class="move-wrap" :class="{ open: movingId === img.id }" @keydown.esc="closeMove">
                <button
                  type="button"
                  class="move-toggle"
                  aria-haspopup="true"
                  :aria-expanded="movingId === img.id"
                  :aria-label="`Flytt bilde ${i + 1}`"
                  @click="toggleMove(img)"
                >
                  Flytt
                </button>
                <div v-if="movingId === img.id" class="move-panel" role="group" :aria-label="`Plassering for bilde ${i + 1}`">
                  <div class="move-pos">
                    <label class="move-pos-label">
                      Plass
                      <input
                        v-model="moveInput"
                        class="move-pos-input"
                        :class="{ invalid: moveError }"
                        type="text"
                        inputmode="numeric"
                        aria-label="Plassering"
                        :aria-invalid="!!moveError"
                        @keydown.enter.prevent="applyMove"
                      />
                    </label>
                    <span>av {{ images.length }}</span>
                    <button type="button" class="move-btn" aria-label="Flytt til valgt plass" :disabled="!!moveError || moveTo === movePos" @click="applyMove">
                      Flytt
                    </button>
                  </div>
                  <p v-if="moveError" class="move-error" role="alert">{{ moveError }}</p>
                  <div class="move-steps">
                    <button type="button" class="move-btn" :disabled="movePos === 1" @click="moveImage(movePos - 1, 0)">Til toppen</button>
                    <button type="button" class="move-btn" :disabled="movePos === 1" @click="moveImage(movePos - 1, movePos - 2)">Opp</button>
                    <button type="button" class="move-btn" :disabled="movePos === images.length" @click="moveImage(movePos - 1, movePos)">Ned</button>
                    <button type="button" class="move-btn" :disabled="movePos === images.length" @click="moveImage(movePos - 1, images.length - 1)">Til bunnen</button>
                  </div>
                </div>
              </div>
              <button v-if="!img.isHero" type="button" class="move-toggle" @click="makeHero(img)">Gjør til hovedbilde</button>
              <button type="button" class="move-toggle photo-remove" @click="remove(img)">Fjern</button>
            </div>
          </div>
        </li>
      </ul>
    </div>

    <label class="photo-add" :class="{ 'is-busy': uploading }">
      <input class="photo-file" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" :disabled="uploading" @change="onPick" />
      <span>{{ uploading ? 'Laster opp…' : '+ Legg til bilde' }}</span>
    </label>

    <p v-if="error" class="photo-error" role="alert">{{ error }}</p>
  </section>
</template>

<script setup lang="ts">
/**
 * PhotoEditor — the entity's own photos (HAS_IMAGE), for every kind (#414, epic #405). Each action
 * is saved at once through /api/admin/<kind>/<slug>/images (no save bar): add, caption, hero,
 * move, remove. Remove takes the photo off this entity only; the file stays. Photos a page shows
 * from its operations, units or organisations are not here.
 *
 * The list and «Flytt» work as in RelationListEditor: a long list is a scroll view of its first
 * rows with «Vis alle N», and «Flytt» opens a panel (place, to top, up, down, to bottom). A change
 * shows at once and is saved behind it, in order; if the save fails the list is read again.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, useTemplateRef, watch } from 'vue'
import { authFetch } from '@/composables/useAuth.ts'

export interface OwnImage {
  id:      string
  url:     string
  caption: string | null
  isHero:  boolean
  order:   number
}

const props = withDefaults(defineProps<{
  /** The URL segment of the entity kind: person, unit, station, … */
  kind: string
  slug: string
  /** More photos than this make a scroll view of the first rows, with a toggle for all of them. 0 = never. */
  visibleRows?: number
}>(), { visibleRows: 4 })
const emit = defineEmits<{ changed: [images: OwnImage[]] }>()

const images    = ref<OwnImage[]>([])
const loading   = ref(true)
const uploading = ref(false)
const error     = ref('')

const endpoint = () => `/api/admin/${encodeURIComponent(props.kind)}/${encodeURIComponent(props.slug)}/images`
const json = (method: string, body: unknown): RequestInit =>
  ({ method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })

async function read(res: Response): Promise<OwnImage[] | null> {
  const body = await res.json().catch(() => ({})) as { images?: OwnImage[], error?: string }
  if (res.ok && body.images) return body.images
  error.value = body.error ?? `Noe gikk galt (${res.status})`
  return null
}

/** Reads the list. `keepError`: after a failed save, so the reason stays on screen beside the list put back. */
async function load(keepError = false) {
  loading.value = true
  if (!keepError) error.value = ''
  try {
    const list = await read(await authFetch(endpoint()))
    if (list) images.value = list
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

// A change shows at once and is saved behind it. The saves go one after another, so quick moves
// reach the server in the order they were made; a failed one reads the list again.
let queue: Promise<void> = Promise.resolve()
function save(init: RequestInit) {
  error.value = ''
  queue = queue.then(async () => {
    try {
      const list = await read(await authFetch(endpoint(), init))
      if (!list) return await load(true)
      emit('changed', list)
    } catch (e) {
      error.value = (e as Error).message
      await load(true)
    }
  })
}

function moveImage(from: number, to: number) {
  if (from === to || to < 0 || to >= images.value.length) return
  const next = [...images.value]
  next.splice(to, 0, ...next.splice(from, 1))
  images.value = next.map((x, i) => ({ ...x, order: i + 1 }))
  save(json('PATCH', { order: next.map(x => x.id) }))
}

function makeHero(img: OwnImage) {
  images.value = images.value.map(x => ({ ...x, isHero: x.id === img.id }))
  save(json('PATCH', { hero: img.id }))
}

function setCaption(img: OwnImage, value: string) {
  const caption = value.trim() || null
  if (caption === img.caption) return
  images.value = images.value.map(x => (x.id === img.id ? { ...x, caption } : x))
  save(json('PATCH', { captions: { [img.id]: caption } }))
}

function remove(img: OwnImage) {
  images.value = images.value.filter(x => x.id !== img.id)
  save(json('DELETE', { id: img.id }))
}

async function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const form = new FormData()
  form.set('file', file)
  uploading.value = true
  error.value = ''
  try {
    await queue
    const list = await read(await authFetch(endpoint(), { method: 'POST', body: form }))
    if (list) {
      images.value = list
      emit('changed', list)
      showAll.value = true   // the new photo is last: show it
    }
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    uploading.value = false
    input.value = ''
  }
}

// A long list is a scroll view of its first `visibleRows` rows, as tall as those rows are (they differ in height).
// Moving a photo shows the whole list: the panel drops below its row and must not be cut off by a short box.
const listId      = `photo-list-${useId()}`
const listEl      = useTemplateRef<HTMLUListElement>('listEl')
const showAll     = ref(false)
const clipHeight  = ref<number | null>(null)
const collapsible = computed(() => props.visibleRows > 0 && images.value.length > props.visibleRows)
const collapsed   = computed(() => collapsible.value && !showAll.value)

function measureClip() {
  const last = listEl.value?.children[props.visibleRows - 1] as HTMLElement | undefined
  clipHeight.value = last ? last.offsetTop + last.offsetHeight : null
}
let listObserver: ResizeObserver | null = null
watch(listEl, el => {
  listObserver?.disconnect()
  listObserver = null
  if (!el) return
  measureClip()
  if (typeof ResizeObserver !== 'undefined') {
    listObserver = new ResizeObserver(measureClip)
    listObserver.observe(el)
  }
}, { flush: 'post' })
watch(() => images.value.length, () => { void nextTick(measureClip) })

// The panel follows its photo, not its place: the photo keeps the panel when it moves.
const movingId  = ref<string | null>(null)
const moveInput = ref('')
const movePos   = computed(() => (movingId.value ? images.value.findIndex(x => x.id === movingId.value) + 1 : 0))
const moveTo    = computed(() => Number(moveInput.value))
const moveError = computed(() => {
  const text = moveInput.value.trim()
  if (!/^\d+$/.test(text)) return 'Skriv et tall.'
  const n = Number(text)
  return n < 1 || n > images.value.length ? `Velg en plass fra 1 til ${images.value.length}.` : ''
})
watch(movePos, pos => { if (pos) moveInput.value = String(pos); else movingId.value = null })

function toggleMove(img: OwnImage) {
  movingId.value = movingId.value === img.id ? null : img.id
  if (!movingId.value) return
  showAll.value = true
  void nextTick(() => document.querySelector<HTMLInputElement>('.photo-editor .move-wrap.open .move-pos-input')?.select())
}
function closeMove() { movingId.value = null }
function applyMove() {
  if (moveError.value || moveTo.value === movePos.value) return
  moveImage(movePos.value - 1, moveTo.value - 1)
}
function onPointerDown(ev: PointerEvent) {
  if (movingId.value && !(ev.target as Element).closest('.move-wrap.open')) closeMove()
}

// The edit panes are mounted on every page view, hidden until «Rediger» is chosen. The list is read when this
// section is first on screen, so a visitor, or an editor who only reads, asks the server for nothing.
const root = useTemplateRef<HTMLElement>('root')
let started = false
let visibleObserver: IntersectionObserver | null = null
function start() {
  started = true
  visibleObserver?.disconnect()
  visibleObserver = null
  void load()
}

onMounted(() => {
  document.addEventListener('pointerdown', onPointerDown)
  if (typeof IntersectionObserver === 'undefined' || !root.value) return start()
  visibleObserver = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) start() })
  visibleObserver.observe(root.value)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown)
  listObserver?.disconnect()
  visibleObserver?.disconnect()
})
watch(() => [props.kind, props.slug], () => { if (started) void load() })
</script>

<style scoped>
.edit-section {
  padding: var(--space-md);
  background: var(--paper-raised);
  border-bottom: 1px solid var(--rule);
}
.edit-section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-md);
  margin: 0 0 var(--space-md);
}
.edit-section-heading {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--muted);
  margin: 0;
}
.edit-section-count { margin-left: var(--space-xs); font-weight: 400; letter-spacing: 0; }
.edit-section-count::before { content: '· '; }

.list-scroll.collapsed {
  overflow-y: auto;
  box-sizing: border-box;
  padding: 2px;            /* room for the focus ring and the border of the rows at the edges */
  margin: -2px;
}
.list-scroll.collapsed:focus-visible { outline: 1px solid var(--focus); }
.list-toggle {
  flex-shrink: 0;
  padding: var(--space-xs) 0;
  font-family: var(--font-sans);
  font-size: var(--size-label);
  font-weight: 500;
  color: var(--ink-soft);
  background: none;
  border: 0;
  cursor: pointer;
  text-decoration: underline;
  text-decoration-color: var(--rule);
  text-underline-offset: 3px;
}
.list-toggle:hover { color: var(--ink); text-decoration-color: var(--ink); }

.photo-empty {
  padding: var(--space-md);
  text-align: center;
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  font-style: italic;
  color: var(--muted);
  border: 1px dashed var(--rule);
  border-radius: var(--radius-md);
}
.photo-list {
  position: relative;           /* the rows' offsetTop is measured from here, as in RelationListEditor (#393) */
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}
.photo-row {
  display: flex;
  gap: var(--space-md);
  padding: var(--space-sm);
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
}
.photo-row.moving { border-color: var(--focus); background: var(--paper-sunken); }
.photo-thumb {
  width: 80px;
  height: 80px;
  flex: none;
  object-fit: cover;
  background: var(--paper-sunken);
  border-radius: 2px;
}
.photo-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--space-sm); }
.photo-caption {
  width: 100%;
  box-sizing: border-box;
  padding: var(--space-sm);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink);
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
}
.photo-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-xs); }
.photo-pos { font-family: var(--font-sans); font-size: var(--size-label); color: var(--ink-soft); margin-right: auto; }
.photo-hero-tag { font-weight: 600; }
.photo-remove { color: var(--ink-soft); }

/* «Flytt», as in RelationListEditor */
.move-wrap { position: relative; flex-shrink: 0; }
.move-toggle,
.move-btn {
  height: 32px;
  padding: 0 var(--space-md);
  font-family: var(--font-sans);
  font-size: var(--size-label);
  font-weight: 500;
  color: var(--ink);
  background: transparent;
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  cursor: pointer;
  white-space: nowrap;
}
.move-toggle:hover,
.move-wrap.open .move-toggle,
.move-btn:hover:not(:disabled) { background: var(--paper-sunken); }
.move-btn:disabled { color: var(--muted); cursor: default; opacity: 0.5; }
.move-panel {
  position: absolute;
  top: calc(100% + var(--space-xs));
  right: 0;
  z-index: 10;
  width: 260px;
  max-width: calc(100vw - 2 * var(--space-md));
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  padding: var(--space-md);
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
}
.move-pos {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink);
  white-space: nowrap;
}
.move-pos-label { display: flex; align-items: center; gap: var(--space-sm); }
.move-pos .move-btn { margin-left: auto; }
.move-pos-input {
  width: 56px;
  box-sizing: border-box;
  padding: var(--space-xs);
  text-align: center;
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink);
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
}
.move-pos-input.invalid { border-color: var(--danger); }
.move-error { margin: 0; font-family: var(--font-sans); font-size: var(--size-label); color: var(--danger); }
.move-steps { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-xs); }

.photo-add {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  margin-top: var(--space-md);
  padding: 0 var(--space-lg);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  font-weight: 500;
  background: var(--faded-red);
  color: var(--paper);
  border-radius: var(--radius-md);
  cursor: pointer;
}
.photo-add.is-busy { background: var(--paper); color: var(--muted); cursor: not-allowed; }
.photo-file { position: absolute; width: 1px; height: 1px; opacity: 0; overflow: hidden; }
.photo-add:focus-within { outline: 2px solid var(--ink); outline-offset: 2px; }
.photo-error { margin: var(--space-md) 0 0; font-family: var(--font-sans); font-size: var(--size-body-ui); color: var(--danger); }
</style>
