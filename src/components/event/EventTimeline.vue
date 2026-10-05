<template>
  <div ref="root" class="tl" role="group" aria-label="Tidslinje">
    <div class="tl-bar">
      <div class="tl-bar-inner">
        <!-- What the timeline is on: the arrow-key cursor if there is one, else the open event. -->
        <div class="tl-head" :class="{ 'tl-head--cursor': !!cursorSlug }">
          <img v-if="focusThumb" class="tl-head-thumb" :src="focusThumb" alt="" draggable="false" />
          <span v-else class="tl-head-dot" :style="{ '--c': focusColor }"></span>
          <div class="tl-head-text">
            <div class="tl-head-title">{{ focused ? focused.title : 'Tidslinje' }}</div>
            <div class="tl-head-meta">{{ focused ? focusMeta : `${events.length} hendelser` }}</div>
          </div>
          <span v-if="cursorSlug" class="tl-head-hint">↵ åpne</span>
        </div>
        <div class="tl-zoom">
          <button type="button" class="tl-btn" aria-label="Zoom ut" :disabled="zoomIdx === 0 || fits" @click="zoom(-1)">&minus;</button>
          <button type="button" class="tl-btn" aria-label="Zoom inn" :disabled="zoomIdx === ZOOMS.length - 1" @click="zoom(1)">+</button>
        </div>
      </div>
    </div>

    <div
      ref="scroller"
      class="tl-scroller"
      :class="{ 'tl-scroller--drag': dragging, 'tl-scroller--fits': fits }"
      tabindex="0"
      role="region"
      aria-label="Tidslinje, bruk piltastene for å bytte hendelse"
      @scroll.passive="onScroll"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="endDrag"
      @pointercancel="endDrag"
      @click.capture="onClickCapture"
      @selectstart.prevent
      @dragstart.prevent
      @keydown="onScrollerKey"
    >
      <div class="tl-track" :style="{ width: totalWidth + 'px', height: TRACK_H + 'px' }">
        <div class="tl-axis" :style="{ top: AXIS_Y + 'px' }"></div>

        <div
          v-for="t in ticks"
          :key="t.key"
          class="tl-tick"
          :class="{ 'tl-tick--year': t.year }"
          :style="{ left: t.x + 'px', top: AXIS_Y + 'px' }"
        >
          <span class="tl-tick-label" draggable="false">{{ t.label }}</span>
        </div>

        <template v-for="m in visible" :key="m.key">
          <!-- the marker on the line -->
          <button
            v-if="m.kind === 'cluster'"
            type="button"
            class="tl-bubble"
            draggable="false"
            :style="{ left: m.x - m.w / 2 + 'px', top: AXIS_Y - m.w / 2 + 'px', width: m.w + 'px', height: m.w + 'px' }"
            :aria-label="`${m.events.length} hendelser, ${m.label}`"
            @click="openCluster(m, $event)"
          >
            {{ m.events.length }}
          </button>
          <button
            v-else
            type="button"
            class="tl-dot"
            draggable="false"
            :class="{
              'tl-dot--selected': m.event.slug === selectedSlug,
              'tl-dot--hash': m.event.slug === hashSlug,
              'tl-dot--cursor': m.event.slug === cursorSlug,
            }"
            :style="{ left: m.x - DOT / 2 + 'px', top: AXIS_Y - DOT / 2 + 'px', '--c': colorFor?.(m.event) || undefined }"
            :aria-label="m.event.title"
            :title="`${m.event.date ?? ''} ${m.event.title}`"
            @click="emit('select', m.event.slug)"
          ></button>

          <!-- its title box, in one of the rows above, joined to the dot by a line -->
          <button
            v-if="m.kind === 'dot' && m.box"
            type="button"
            class="tl-box"
            draggable="false"
            :class="{
              'tl-box--selected': m.event.slug === selectedSlug,
              'tl-box--hash': m.event.slug === hashSlug,
              'tl-box--cursor': m.event.slug === cursorSlug,
            }"
            :style="{
              left: m.x + 'px',
              top: m.box.top + 'px',
              width: m.box.w + 'px',
              height: BOX_H + 'px',
              '--w': m.box.w + 'px',
              '--z': centreZ(m.x, m.box.w),
              '--lead': AXIS_Y - m.w / 2 - (m.box.top + BOX_H) + 'px',
              '--org': colorFor?.(m.event) || 'var(--ink-soft)',
            }"
            tabindex="-1"
            aria-hidden="true"
            @click="emit('select', m.event.slug)"
          >
            <span class="tl-box-text">{{ m.box.text }}</span>
          </button>
        </template>
      </div>
    </div>

    <!-- the arrow keys move a cursor; this tells a screen reader where it is -->
    <span class="tl-sr" aria-live="polite">{{ cursorTitle }}</span>

    <div
      v-if="popover"
      class="tl-pop"
      :style="{ left: popover.left + 'px', top: popover.top + 'px' }"
      role="dialog"
      :aria-label="`${popover.events.length} hendelser`"
    >
      <div class="tl-pop-head">{{ popover.events.length }} hendelser · {{ popover.label }}</div>
      <ul class="tl-pop-list">
        <li v-for="e in popover.events" :key="e.slug">
          <button type="button" class="tl-pop-item" @click="pick(e.slug)">
            <span class="tl-pop-date">{{ e.date }}</span>
            <span class="tl-pop-title">{{ e.title }}</span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Prototype for #88: a timeline that only draws what is in view.
 *
 * Like the TimelineJS it replaces, every event sits on ONE line, and its
 * title is in a box in one of ROWS rows above the line, joined to the dot
 * by a leader line. A box is only drawn when a row has room for it, so
 * zooming in shows more titles. Events that would land on top of each other
 * on the line become a count bubble.
 *
 * Positions are computed once per zoom level for all events. Only the slice
 * inside the scroll viewport goes into the DOM, found by binary search over
 * the x-sorted markers. The selected and the #hash event are never swallowed
 * by a bubble and always get their box.
 *
 * Clicking a bubble zooms in one step, centred on it. One that cannot split
 * (a single day, or already at the deepest zoom) opens a list of its events
 * instead: the data has a day with 56 events.
 *
 * Scrolling to a selected event never emits `select`, only a click does, so
 * there is no `externalChange` flag to keep.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { IdbEvent } from '../../types/idb.ts'

const props = defineProps<{
  events: IdbEvent[]
  selectedSlug?: string
  hashSlug?: string
  colorFor?: (e: IdbEvent) => string
}>()
const emit = defineEmits<{ select: [slug: string] }>()

const ZOOMS = [0.5, 1, 2, 4, 8, 16]   // px per day
const DOT = 10
const CLUSTER_PX = DOT     // markers closer than a dot's width on the line become one bubble
const MIN_CLUSTER = 2
const ROWS = 4             // rows of title boxes above the line
const BOX_H = 22
const ROW_GAP = 4
const BOX_MAX_W = 170
const BOX_GAP = 6          // free space kept after a box in its row
const PAD_TOP = 8
const AXIS_Y = PAD_TOP + ROWS * (BOX_H + ROW_GAP) + 10
const TRACK_H = AXIS_Y + 34
const BUFFER = 200
const DAY = 86_400_000

const zoomIdx = ref(3)
/** The event the arrow keys have moved to. Not the open event: nothing opens until Enter or a click. */
const cursorSlug = ref('')
const root = ref<HTMLElement | null>(null)
const scroller = ref<HTMLElement | null>(null)
const scrollLeft = ref(0)
const viewWidth = ref(1000)

const pxPerDay = computed(() => ZOOMS[zoomIdx.value])

function toDay(date: string | undefined): number {
  const [y, m, d] = (date ?? '').split('-')
  return Date.UTC(Number(y) || 1940, (Number(m) || 1) - 1, Number(d) || 1) / DAY
}

function dayLabel(day: number): string {
  return new Date(day * DAY).toISOString().slice(0, 10)
}

/** Events with a day number, in date order. Re-derived only when the events change. */
const dated = computed(() =>
  props.events
    .map(event => ({ event, day: toDay(event.date) }))
    .sort((a, b) => a.day - b.day),
)

/**
 * The date range the track covers: the events plus a margin, widened evenly on
 * both sides when that is narrower than the view, so zoomed far out the line
 * still runs edge to edge instead of stopping part-way across.
 */
const baseMin = computed(() => (dated.value[0]?.day ?? 0) - 15)
const baseMax = computed(() => (dated.value[dated.value.length - 1]?.day ?? 0) + 15)
const spare = computed(() => Math.max(0, (viewWidth.value / pxPerDay.value - (baseMax.value - baseMin.value)) / 2))
const minDay = computed(() => baseMin.value - spare.value)
const maxDay = computed(() => baseMax.value + spare.value)
const totalWidth = computed(() => Math.max(1, (maxDay.value - minDay.value) * pxPerDay.value))
/** The whole range is in view: nothing to pan, and no point zooming further out. */
const fits = computed(() => totalWidth.value <= viewWidth.value + 1)

interface Box { top: number; w: number; text: string }
interface Dot { kind: 'dot'; key: string; event: IdbEvent; x: number; w: number; pinned: boolean; box?: Box }
interface Bubble {
  kind: 'cluster'; key: string; events: IdbEvent[]; x: number; w: number; pinned: false
  fromDay: number; toDay: number; label: string; box?: Box
}
type Marker = Dot | Bubble

/** A rough text width: the title boxes use 11px sans, about 6 px a character. */
function boxWidth(text: string): number {
  return Math.min(BOX_MAX_W, Math.round(14 + text.length * 6))
}

/** Markers on the line, then title boxes in the rows above where there is room. */
const markers = computed<Marker[]>(() => {
  const pinned = new Set([props.selectedSlug, props.hashSlug, cursorSlug.value].filter(Boolean))
  const out: Marker[] = []
  let run: { event: IdbEvent; day: number; x: number }[] = []

  const flush = () => {
    if (run.length >= MIN_CLUSTER) {
      const first = run[0], last = run[run.length - 1]
      const span = first.day === last.day ? dayLabel(first.day) : `${dayLabel(first.day)} – ${dayLabel(last.day)}`
      out.push({
        kind: 'cluster', key: `c:${first.event.slug}`, events: run.map(r => r.event), pinned: false,
        x: run.reduce((s, r) => s + r.x, 0) / run.length,
        w: Math.min(34, 16 + 4 * Math.log2(run.length)),
        fromDay: first.day, toDay: last.day, label: span,
      })
    } else {
      for (const r of run) out.push({ kind: 'dot', key: r.event.slug, event: r.event, x: r.x, w: DOT, pinned: false })
    }
    run = []
  }

  for (const { event, day } of dated.value) {
    const x = (day - minDay.value) * pxPerDay.value
    if (event.slug && pinned.has(event.slug)) {
      flush()
      out.push({ kind: 'dot', key: event.slug, event, x, w: DOT, pinned: true })
    } else {
      if (run.length && x - run[0].x > CLUSTER_PX) flush()
      run.push({ event, day, x })
    }
  }
  flush()
  out.sort((a, b) => a.x - b.x)

  // Boxes. The pinned ones (open event, #hash, arrow-key cursor) are placed first
  // and everything else works around them. They avoid each other too: each takes
  // the lowest row that is free at its x, the open event first and the cursor
  // last (its box shows the whole title, so it is the widest).
  const rowTop = (r: number) => AXIS_Y - 10 - BOX_H - r * (BOX_H + ROW_GAP)
  const reserved: { row: number; from: number; to: number }[] = []
  const rank = (slug: string) => (slug === props.selectedSlug ? 0 : slug === props.hashSlug ? 1 : 2)
  const pinnedDots = out
    .filter((m): m is Dot => m.pinned && m.kind === 'dot')
    .sort((a, b) => rank(a.event.slug) - rank(b.event.slug))
  for (const m of pinnedDots) {
    const full = m.event.slug === cursorSlug.value
    const w = full ? Math.min(520, Math.round(14 + m.event.title.length * 6.5)) : boxWidth(m.event.title)
    let row = 0
    while (row < ROWS - 1 && reserved.some(q => q.row === row && m.x < q.to && m.x + w + BOX_GAP > q.from)) row++
    m.box = { top: rowTop(row), w, text: m.event.title }
    reserved.push({ row, from: m.x, to: m.x + w + BOX_GAP })
  }
  const rowEnd = new Array<number>(ROWS).fill(-Infinity)
  for (const m of out) {
    if (m.box || m.kind === 'cluster') continue   // a bubble carries its own count; rows are for titles
    const text = m.event.title
    const w = boxWidth(text)
    for (let r = 0; r < ROWS; r++) {
      if (rowEnd[r] > m.x) continue
      if (reserved.some(q => q.row === r && m.x < q.to && m.x + w + BOX_GAP > q.from)) continue
      m.box = { top: rowTop(r), w, text }
      rowEnd[r] = m.x + w + BOX_GAP
      break
    }
  }
  return out
})

/** First index whose x is >= `x` (markers are sorted by x). */
function lowerBound(x: number): number {
  let lo = 0, hi = markers.value.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (markers.value[mid].x < x) lo = mid + 1; else hi = mid
  }
  return lo
}

const visible = computed(() => {
  // A box reaches up to BOX_MAX_W to the right of its marker, so look that far back.
  const from = scrollLeft.value - BUFFER - BOX_MAX_W
  const to = scrollLeft.value + viewWidth.value + BUFFER
  const out: Marker[] = []
  for (let i = lowerBound(from); i < markers.value.length && markers.value[i].x <= to; i++) out.push(markers.value[i])
  return out
})

/**
 * Stacking by distance from the middle of the view: a box at the centre is on
 * top of its neighbours, and the further out towards either edge, the lower it
 * sits. Hover and focus (and the selected / #hash box) stay above all of these.
 */
const Z_MIN = 10
const Z_MAX = 50
function centreZ(x: number, w: number): number {
  const half = viewWidth.value / 2 + BOX_MAX_W
  const d = Math.abs(x + w / 2 - (scrollLeft.value + viewWidth.value / 2)) / half
  return Z_MIN + Math.round((1 - Math.min(1, d)) * (Z_MAX - Z_MIN))
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des']

/** Year ticks, plus month ticks once there is room for them. Only the visible ones. */
const ticks = computed(() => {
  const out: { key: string; x: number; label: string; year: boolean }[] = []
  const fromDay = minDay.value + (scrollLeft.value - BUFFER) / pxPerDay.value
  const toDay_ = minDay.value + (scrollLeft.value + viewWidth.value + BUFFER) / pxPerDay.value
  const y0 = new Date(fromDay * DAY).getUTCFullYear()
  const y1 = new Date(toDay_ * DAY).getUTCFullYear()
  const months = pxPerDay.value >= 4
  for (let y = y0; y <= y1; y++) {
    for (let m = 0; m < (months ? 12 : 1); m++) {
      const x = (Date.UTC(y, m, 1) / DAY - minDay.value) * pxPerDay.value
      if (x < 0 || x > totalWidth.value) continue
      out.push({ key: `${y}-${m}`, x, label: m === 0 ? String(y) : MONTHS[m], year: m === 0 })
    }
  }
  return out
})

// ── Panning: drag with the mouse, as in the timeline this replaces ──
// The scrollbar is hidden. A mouse (or pen) drags the line sideways; touch keeps
// its native swipe; the arrow keys step between events. A drag must not click the marker it
// started on, so the click that follows one is swallowed.
const DRAG_MIN = 4   // px of movement before it is a drag and not a click
const dragging = ref(false)
let dragFrom: { x: number; left: number; id: number } | null = null
let dragged = false

function onPointerDown(e: PointerEvent) {
  // Not `=== 'mouse'`: a mouse can be reported as a pen (a virtual machine's
  // absolute pointer is), and then it would never drag. Only touch is left to
  // the browser's own swipe.
  if (e.pointerType === 'touch' || e.button !== 0 || !scroller.value) return
  dragFrom = { x: e.clientX, left: scroller.value.scrollLeft, id: e.pointerId }
  dragged = false
}
function onPointerMove(e: PointerEvent) {
  const el = scroller.value
  if (!dragFrom || !el || e.pointerId !== dragFrom.id) return
  // clientX moves in screen pixels; scrollLeft is in the zoomed CSS pixels (the app's .shell zoom).
  const z = el.getBoundingClientRect().width / (el.offsetWidth || 1)
  const dx = (e.clientX - dragFrom.x) / z
  if (!dragged && Math.abs(dx) < DRAG_MIN) return
  if (!dragged) {
    dragged = true
    dragging.value = true
    closePopover()
    el.setPointerCapture(e.pointerId)
  }
  el.scrollLeft = dragFrom.left - dx
}
function endDrag(e: PointerEvent) {
  if (!dragFrom || e.pointerId !== dragFrom.id) return
  const el = scroller.value
  if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
  dragFrom = null
  dragging.value = false
  // `dragged` stays true until the click that follows has been swallowed.
  if (dragged) setTimeout(() => { dragged = false }, 0)
}
function onClickCapture(e: MouseEvent) {
  if (!dragged) return
  e.stopPropagation()
  e.preventDefault()
  dragged = false
}
/**
 * Left and right move a cursor to the previous or next event, over everything
 * on the timeline, and nothing else happens: the open event, the filters and
 * the detail panel stay as they are. Only Enter (or a click) opens the event
 * under the cursor, which is the one thing that shifts the context and narrows
 * the timeline to that event's organisation and district. Escape drops the
 * cursor. With no cursor and no open event, the first press lands on the event
 * nearest the middle of the view.
 */
function onScrollerKey(e: KeyboardEvent) {
  const el = scroller.value
  if (!el) return
  if (e.key === 'Enter' || e.key === ' ') {
    if (!cursorSlug.value) return
    e.preventDefault()
    emit('select', cursorSlug.value)
    return
  }
  if (e.key === 'Escape') {
    cursorSlug.value = ''
    return
  }
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
  const list = dated.value
  if (!list.length) return
  e.preventDefault()

  const base = cursorSlug.value || target.value
  const from = base ? list.findIndex(d => d.event.slug === base) : -1
  if (from < 0) {
    const centreDay = minDay.value + (el.scrollLeft + el.clientWidth / 2) / pxPerDay.value
    let best = 0
    for (let i = 1; i < list.length; i++) {
      if (Math.abs(list[i].day - centreDay) < Math.abs(list[best].day - centreDay)) best = i
    }
    void moveCursor(list[best].event.slug)
    return
  }
  const next = Math.min(list.length - 1, Math.max(0, from + (e.key === 'ArrowLeft' ? -1 : 1)))
  if (next !== from) void moveCursor(list[next].event.slug)
}

/** Put the cursor on `slug`, scrolling only when it is close to an edge of the view. */
async function moveCursor(slug: string) {
  cursorSlug.value = slug
  const hit = dated.value.find(d => d.event.slug === slug)
  const el = scroller.value
  if (!hit || !el) return
  await nextTick()   // the cursor is pinned, so the layout is recomputed first
  const px = (hit.day - minDay.value) * pxPerDay.value - el.scrollLeft
  if (px < el.clientWidth * 0.15 || px > el.clientWidth * 0.85) scrollToDay(hit.day)
}

/** The event the header shows: the cursor while browsing, else the open one. */
const focused = computed<IdbEvent | null>(() => {
  const slug = cursorSlug.value || target.value
  return slug ? (props.events.find(e => e.slug === slug) ?? null) : null
})
const focusThumb = computed(() => {
  const url = focused.value?.thumbnailUrl
  return url ? `${url.replace(/\?.*$/, '')}?w=80&h=80&fit=crop&auto=format` : ''
})
const focusColor = computed(() => (focused.value && props.colorFor?.(focused.value)) || 'var(--ink-soft)')
function fmtDate(date: string | undefined): string {
  if (!date) return ''
  return new Date(toDay(date) * DAY).toLocaleDateString('nb-NO', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' })
}
const focusMeta = computed(() => {
  const e = focused.value
  if (!e) return ''
  return [fmtDate(e.date), e.organization, e.district].filter(Boolean).join(' · ')
})

const cursorTitle = computed(() => {
  const hit = cursorSlug.value ? dated.value.find(d => d.event.slug === cursorSlug.value) : undefined
  return hit ? `${hit.event.date ?? ''} ${hit.event.title}`.trim() : ''
})

let raf = 0
function onScroll() {
  closePopover()
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    scrollLeft.value = scroller.value?.scrollLeft ?? 0
  })
}

function measure() {
  viewWidth.value = scroller.value?.clientWidth ?? viewWidth.value
}

function scrollToDay(day: number) {
  const el = scroller.value
  if (!el) return
  el.scrollLeft = (day - minDay.value) * pxPerDay.value - el.clientWidth / 2
  scrollLeft.value = el.scrollLeft
}

function scrollToSlug(slug: string | undefined): boolean {
  const hit = slug ? dated.value.find(d => d.event.slug === slug) : undefined
  if (!hit) return false
  scrollToDay(hit.day)
  return true
}

/** A date and where it sits on screen (px from the left edge of the view). */
interface Anchor { day: number; px: number }

/**
 * What stays put when the zoom changes. The open event, if it is in view, keeps
 * its place on screen; otherwise the middle of the view does. (Anchoring on the
 * middle alone slid the open event out of sight whenever it sat near an end of
 * the track, where the view cannot centre on it.)
 */
function defaultAnchor(el: HTMLElement): Anchor {
  const focusSlug = cursorSlug.value || target.value
  const sel = focusSlug ? dated.value.find(d => d.event.slug === focusSlug) : undefined
  if (sel) {
    const px = (sel.day - minDay.value) * pxPerDay.value - el.scrollLeft
    if (px >= 0 && px <= el.clientWidth) return { day: sel.day, px }
  }
  return { day: minDay.value + (el.scrollLeft + el.clientWidth / 2) / pxPerDay.value, px: el.clientWidth / 2 }
}

/** Change zoom, keeping `anchor` (default: see defaultAnchor) where it is on screen. */
async function zoomTo(idx: number, anchor?: Anchor) {
  const el = scroller.value
  const next = Math.min(ZOOMS.length - 1, Math.max(0, idx))
  if (!el || next === zoomIdx.value) return
  const keep = anchor ?? defaultAnchor(el)
  closePopover()
  zoomIdx.value = next
  await nextTick()
  el.scrollLeft = (keep.day - minDay.value) * pxPerDay.value - keep.px
  scrollLeft.value = el.scrollLeft
}
const zoom = (step: number) => zoomTo(zoomIdx.value + step)

// ── Bubble click: zoom in while it can still split, else list its events ──
interface Popover { events: IdbEvent[]; label: string; left: number; top: number }
const popover = ref<Popover | null>(null)

function closePopover() {
  if (!popover.value) return
  popover.value = null
  document.removeEventListener('keydown', onKey)
  document.removeEventListener('pointerdown', onOutside, true)
}
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') closePopover() }
function onOutside(e: PointerEvent) {
  if (!(e.target as HTMLElement).closest('.tl-pop')) closePopover()
}

function openCluster(b: Bubble, ev: MouseEvent) {
  const canSplit = b.toDay > b.fromDay && zoomIdx.value < ZOOMS.length - 1
  if (canSplit) {
    void zoomTo(zoomIdx.value + 1, { day: (b.fromDay + b.toDay) / 2, px: (scroller.value?.clientWidth ?? 0) / 2 })
    return
  }
  const el = root.value
  if (!el) return
  const rootRect = el.getBoundingClientRect()
  const btn = (ev.currentTarget as HTMLElement).getBoundingClientRect()
  // Screen pixels per CSS pixel: not 1 under the app's CSS zoom (.shell, 1600 px and up).
  const z = rootRect.width / (el.offsetWidth || 1)
  const width = 320
  popover.value = {
    events: b.events, label: b.label,
    left: Math.max(4, Math.min((btn.left - rootRect.left) / z, el.offsetWidth - width - 4)),
    top: (btn.bottom - rootRect.top) / z + 6,
  }
  document.addEventListener('keydown', onKey)
  document.addEventListener('pointerdown', onOutside, true)
}

function pick(slug: string) {
  closePopover()
  emit('select', slug)
}

const target = computed(() => props.hashSlug || props.selectedSlug || '')

// The view's width changes for more than a window resize: the page's own
// vertical scrollbar appears after the list has loaded. Watch the element.
let resizeObserver: ResizeObserver | null = null

onMounted(async () => {
  measure()
  if (scroller.value) {
    resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(scroller.value)
  }
  await nextTick()
  if (!scrollToSlug(target.value) && dated.value.length) scrollToDay(dated.value[0].day)
})
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  closePopover()
  if (raf) cancelAnimationFrame(raf)
})

// A new selection (link, list, #hash) moves the timeline; it never navigates back.
watch(target, async (slug) => {
  cursorSlug.value = ''
  await nextTick()
  scrollToSlug(slug)
})
// Filters changed: keep the scroll position if the selected event survives, else go to the start.
watch(() => props.events, async () => {
  closePopover()
  if (cursorSlug.value && !props.events.some(e => e.slug === cursorSlug.value)) cursorSlug.value = ''
  await nextTick()
  if (!scrollToSlug(target.value) && dated.value.length) scrollToDay(dated.value[0].day)
})
</script>

<style scoped>
.tl {
  position: relative;
  background: var(--paper);
  /* A press on a label must start a drag, not a text selection (the old timeline
   * is not selectable either). The titles stay in the detail panel and in aria. */
  user-select: none;
  -webkit-user-select: none;
  -webkit-user-drag: none;
}
.tl * { -webkit-user-drag: none; }

/* The bar spans the window; its content sits in the same centred column and
 * side padding as the filters and the list (EventsView: 1320px, 12px). */
.tl-bar {
  border-top: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
  background: var(--paper-raised);
}
.tl-bar-inner {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  max-width: 1320px;
  min-height: 52px;
  margin-inline: auto;
  padding: 8px 12px;
}

/* Header: the focused event's picture (or its organisation's colour), title and date. */
.tl-head {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}
.tl-head-thumb {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  object-fit: cover;
  border: 1px solid var(--rule);
  border-radius: 3px;
}
.tl-head-dot {
  flex-shrink: 0;
  width: 12px;
  height: 12px;
  margin: 0 12px;
  border-radius: 50%;
  background: var(--c, var(--ink-soft));
}
.tl-head-text { min-width: 0; }
.tl-head-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: 600 15px/1.25 var(--font-serif);
  color: var(--ink);
}
.tl-head-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: 11px/1.3 var(--font-sans);
  color: var(--muted);
}
.tl-head-hint {
  flex-shrink: 0;
  padding: 1px 6px;
  border: 1px solid var(--ink);
  border-radius: 3px;
  font: 700 10px/1.4 var(--font-sans);
  color: var(--ink);
}
.tl-head--cursor .tl-head-title { font-weight: 700; }

.tl-zoom { flex-shrink: 0; display: flex; gap: 6px; }

.tl-btn {
  width: 28px;
  height: 28px;
  border: 1px solid var(--rule);
  border-radius: 4px;
  background: var(--paper);
  color: var(--ink);
  font: 600 16px/1 var(--font-sans);
  cursor: pointer;
}
.tl-btn:disabled { opacity: 0.4; cursor: default; }

.tl-scroller {
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior-x: contain;
  /* No scrollbar: like the old timeline, the move cursor says it can be dragged. */
  scrollbar-width: none;
  cursor: move;
}
.tl-scroller::-webkit-scrollbar { display: none; }
.tl-scroller--drag { user-select: none; }
.tl-scroller--fits { cursor: default; }
/* The arrow keys step between events and the open one is already marked; a ring round the whole timeline only gets in the way. */
.tl-scroller:focus,
.tl-scroller:focus-visible { outline: none; }

.tl-track { position: relative; isolation: isolate; }

.tl-axis {
  position: absolute;
  left: 0;
  right: 0;
  border-top: 2px solid var(--ink-soft);
}

.tl-tick {
  position: absolute;
  width: 0;
  height: 8px;
  border-left: 1px solid var(--ink-soft);
}
.tl-tick--year { height: 14px; border-left-width: 2px; }
.tl-tick-label {
  position: absolute;
  top: 100%;
  left: 3px;
  white-space: nowrap;
  font: 10px var(--font-mono);
  color: var(--muted);
}
.tl-tick--year .tl-tick-label { font-weight: 700; color: var(--ink-soft); }

.tl-dot {
  position: absolute;
  z-index: 2;
  width: 10px;
  height: 10px;
  padding: 0;
  border: 1px solid var(--paper);
  border-radius: 50%;
  background: var(--c, var(--ink-soft));
  cursor: pointer;
}
.tl-dot:hover { transform: scale(1.4); }
.tl-dot:focus-visible,
.tl-bubble:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.tl-dot--hash     { box-shadow: 0 0 0 3px var(--focus); z-index: 4; }
.tl-dot--cursor   { box-shadow: 0 0 0 2px var(--paper), 0 0 0 4px var(--ink); z-index: 6; }
.tl-dot--selected { box-shadow: 0 0 0 3px var(--faded-red); z-index: 5; }

.tl-bubble {
  position: absolute;
  z-index: 2;
  padding: 0;
  border: 1px solid var(--ink-soft);
  border-radius: 50%;
  background: var(--paper-raised);
  color: var(--ink);
  font: 700 10px/1 var(--font-sans);
  cursor: pointer;
}
.tl-bubble:hover { background: var(--paper-sunken); }

/* Title box: sits in a row above the line; its left edge runs down to the dot. */
.tl-box {
  position: absolute;
  z-index: var(--z, 1);
  box-sizing: border-box;
  padding: 0 6px;
  overflow: visible;
  text-align: left;
  font: 11px/20px var(--font-sans);
  color: var(--ink);
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-left: 3px solid var(--org, var(--ink-soft));
  border-radius: 2px;
  cursor: pointer;
}
.tl-box::after {
  content: '';
  position: absolute;
  left: -3px;
  top: 100%;
  height: var(--lead, 0);
  border-left: 1px solid var(--org, var(--ink-soft));
  opacity: 0.7;
}
/* The text clips to "…" in the box; on hover the box grows to show the whole title. */
.tl-box-text {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.tl-box:hover,
.tl-box:focus-visible {
  width: max-content !important;
  min-width: var(--w);
  max-width: 520px;
  background: var(--paper-sunken);
  z-index: 100;
}
.tl-box--hash     { border-color: var(--focus); z-index: 60; }
/* The arrow-key cursor: its own mark, and always the whole title. */
.tl-box--cursor {
  width: max-content !important;
  min-width: var(--w);
  max-width: 520px;
  background: var(--paper);
  outline: 2px solid var(--ink);
  outline-offset: 1px;
  font-weight: 700;
  z-index: 75;
}
.tl-box--selected { border-color: var(--faded-red); background: var(--paper); font-weight: 700; z-index: 70; }

.tl-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.tl-pop {
  position: absolute;
  z-index: 10;
  width: 320px;
  max-height: 236px;
  display: flex;
  flex-direction: column;
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: 6px;
  box-shadow: var(--shadow-lg);
}
.tl-pop-head {
  flex-shrink: 0;
  padding: 6px 10px;
  border-bottom: 1px solid var(--rule);
  font: 700 10px var(--font-sans);
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--muted);
}
.tl-pop-list { margin: 0; padding: 0; list-style: none; overflow-y: auto; }
.tl-pop-item {
  display: flex;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  border: 0;
  border-bottom: 1px solid var(--rule);
  background: none;
  color: var(--ink);
  text-align: left;
  font: 12px var(--font-sans);
  cursor: pointer;
}
.tl-pop-item:hover { background: var(--paper-sunken); }
.tl-pop-date { flex-shrink: 0; font: 10px var(--font-mono); color: var(--muted); padding-top: 2px; }
.tl-pop-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Dark mode (DESIGN-dark.md). The tokens above switch on their own. The organisation colours come
 * from data and some are dark enough to vanish on dark paper (#2f146e, #724a11), so they are lifted
 * toward the cream ink: the hue stays, the dot stays readable. Photos get the warm filter. */
@media (prefers-color-scheme: dark) {
  .tl-dot,
  .tl-head-dot { background: color-mix(in srgb, var(--c, var(--ink-soft)) 62%, var(--ink)); }
  .tl-box { border-left-color: color-mix(in srgb, var(--org, var(--ink-soft)) 62%, var(--ink)); }
  .tl-box::after { border-left-color: color-mix(in srgb, var(--org, var(--ink-soft)) 62%, var(--ink)); }
  .tl-head-thumb { filter: sepia(4%) brightness(0.98); }
}
</style>
