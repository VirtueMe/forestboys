<template>
  <div v-if="images.length" class="image-slider">
    <div
      class="slider-stage"
      :tabindex="images.length > 1 ? 0 : -1"
      role="region"
      aria-label="Bildekarusell"
      @keydown.left.prevent="prev"
      @keydown.right.prevent="next"
      @pointerdown="onPointerDown"
      @pointerup="onPointerUp"
      @pointercancel="swipeStartX = null"
    >
      <button
        v-if="images.length > 1"
        class="slider-nav slider-prev"
        type="button"
        aria-label="Forrige"
        @click="prev"
      >
        ‹
      </button>

      <img
        v-if="currentImage"
        :src="currentSrc"
        :alt="currentImage.caption ?? currentImage.subjectName ?? ''"
        class="slider-image"
        loading="eager"
        draggable="false"
      />

      <button
        v-if="images.length > 1"
        class="slider-nav slider-next"
        type="button"
        aria-label="Neste"
        @click="next"
      >
        ›
      </button>
    </div>

    <div class="slider-meta">
      <span class="slider-counter">
        <input
          v-if="images.length > 1"
          :value="currentIndex + 1"
          class="slider-counter-input"
          type="number"
          min="1"
          :max="images.length"
          :aria-label="`Gå til bilde (1–${images.length})`"
          @change="onCounterChange"
          @focus="($event.target as HTMLInputElement).select()"
        />
        <template v-else>{{ currentIndex + 1 }}</template>
        <span> / {{ images.length }}</span>
      </span>
      <p v-if="currentImage" class="slider-caption">
        <RouterLink
          v-if="currentImage.subjectSlug && currentImage.subjectType"
          :to="subjectRoute(currentImage)"
          class="slider-subject"
        >
          {{ currentImage.subjectName }}
        </RouterLink>
        <span v-else-if="currentImage.subjectName" class="slider-subject">
          {{ currentImage.subjectName }}
        </span>
        <span v-if="currentImage.caption" class="slider-text"> — {{ currentImage.caption }}</span>
      </p>
    </div>

    <div v-if="images.length > 1" ref="stripEl" class="slider-thumbs">
      <button
        v-for="(img, i) in images"
        :key="img.url"
        :ref="el => setThumbRef(el as HTMLElement | null, i)"
        type="button"
        class="slider-thumb"
        :class="{ active: i === currentIndex }"
        :aria-label="`Bilde ${i + 1}`"
        :aria-current="i === currentIndex ? 'true' : undefined"
        @click="currentIndex = i"
      >
        <img
          :src="thumbSrc(img.url)"
          :alt="img.caption ?? img.subjectName ?? ''"
          loading="lazy"
          decoding="async"
        />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { RouterLink } from 'vue-router'

export interface SlideImage {
  url: string
  caption?: string | null
  subjectName?: string | null
  subjectSlug?: string | null
  subjectType?: 'unit' | 'person' | 'incident' | 'station' | 'location' | 'transport' | 'organization'
}

const props = defineProps<{ images: SlideImage[] }>()
const currentIndex = ref(0)

const currentImage = computed(() => props.images[currentIndex.value] ?? null)

// Sanity CDN transform — ~80% smaller than original, modern formats served
// when the browser supports them. 900px is enough for typical desktop view;
// mobile gets the same image scaled down by the browser.
function transformed(url: string, w = 900): string {
  if (!url) return ''
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}w=${w}&auto=format&q=80`
}

const currentSrc = computed(() => (currentImage.value ? transformed(currentImage.value.url, 900) : ''))

function thumbSrc(url: string): string {
  return transformed(url, 160)
}

// Preload adjacent images so prev/next is instant. Browser-cached after fetch.
function preload(url: string) {
  if (typeof window === 'undefined') return
  const img = new Image()
  img.src = transformed(url, 900)
}

const stripEl = ref<HTMLElement | null>(null)
const thumbRefs = new Map<number, HTMLElement>()
function setThumbRef(el: HTMLElement | null, i: number) {
  if (el) thumbRefs.set(i, el)
  else thumbRefs.delete(i)
}

// Center the active thumb inside its own scroll container via scrollLeft —
// scrollIntoView({ block: 'nearest' }) would also scroll the PAGE viewport
// when the gallery is below the fold, yanking the reader down to the slider
// on every navigation.
watch(currentIndex, async () => {
  if (props.images.length < 2) return
  const len = props.images.length
  preload(props.images[(currentIndex.value + 1) % len].url)
  preload(props.images[(currentIndex.value - 1 + len) % len].url)

  await nextTick()
  const thumb = thumbRefs.get(currentIndex.value)
  const strip = stripEl.value
  if (!thumb || !strip) return
  const target = thumb.offsetLeft - (strip.clientWidth - thumb.offsetWidth) / 2
  strip.scrollTo({ left: target, behavior: 'smooth' })
}, { immediate: true })

// Reset to first slide when the image set changes (e.g. route change reuses component).
watch(() => props.images, () => { currentIndex.value = 0 })

function prev() {
  if (props.images.length < 2) return
  currentIndex.value = (currentIndex.value - 1 + props.images.length) % props.images.length
}
function next() {
  if (props.images.length < 2) return
  currentIndex.value = (currentIndex.value + 1) % props.images.length
}

// Swipe: horizontal drag > 40px on the main stage flips to prev/next.
// Vertical drags are ignored so page-scroll still works on mobile.
const SWIPE_THRESHOLD = 40
let swipeStartX: number | null = null
let swipeStartY = 0
function onPointerDown(e: PointerEvent) {
  if (props.images.length < 2) return
  if (e.pointerType === 'mouse' && e.button !== 0) return
  swipeStartX = e.clientX
  swipeStartY = e.clientY
}
function onPointerUp(e: PointerEvent) {
  if (swipeStartX === null) return
  const dx = e.clientX - swipeStartX
  const dy = e.clientY - swipeStartY
  swipeStartX = null
  if (Math.abs(dx) < SWIPE_THRESHOLD) return
  if (Math.abs(dy) > Math.abs(dx)) return
  if (dx < 0) next()
  else prev()
}

function onCounterChange(e: Event) {
  const input = e.target as HTMLInputElement
  const n = Number(input.value)
  if (!Number.isFinite(n)) { input.value = String(currentIndex.value + 1); return }
  const clamped = Math.max(1, Math.min(props.images.length, Math.round(n)))
  currentIndex.value = clamped - 1
  input.value = String(clamped)
}

function subjectRoute(img: SlideImage): string {
  if (!img.subjectSlug || !img.subjectType) return '/'
  switch (img.subjectType) {
    case 'unit':         return `/district/${img.subjectSlug}`
    case 'organization': return `/organization/${img.subjectSlug}`
    case 'person':       return `/person/${img.subjectSlug}`
    case 'incident':     return `/events/${img.subjectSlug}`
    case 'station':      return `/station/${img.subjectSlug}`
    case 'location':     return `/location/${img.subjectSlug}`
    case 'transport':    return `/transport/${img.subjectSlug}`
    default:             return '/'
  }
}
</script>

<style scoped>
.image-slider {
  width: 100%;
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: 6px;
  overflow: hidden;
}

.slider-stage {
  position: relative;
  background: #000;
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 280px;
  max-height: 560px;
  overflow: hidden;
  touch-action: pan-y;
  user-select: none;
  outline: none;
}
.slider-stage:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}

.slider-image {
  width: 100%;
  max-height: 560px;
  object-fit: contain;
  display: block;
}

.slider-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  border: 0;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  font-size: 28px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
  -webkit-tap-highlight-color: transparent;
}
.slider-nav:hover { background: rgba(0, 0, 0, 0.65); }
.slider-prev { left: 10px; }
.slider-next { right: 10px; }

.slider-meta {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 8px 12px;
  border-top: 1px solid var(--rule);
}

.slider-counter {
  font-size: 11px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
  display: inline-flex;
  align-items: baseline;
  gap: 2px;
}

.slider-counter-input {
  width: 3.5ch;
  padding: 1px 3px;
  border: 1px solid var(--rule);
  border-radius: 3px;
  background: var(--paper-raised);
  color: var(--ink);
  font: inherit;
  font-variant-numeric: tabular-nums;
  text-align: right;
  -moz-appearance: textfield;
}
.slider-counter-input::-webkit-outer-spin-button,
.slider-counter-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.slider-counter-input:focus {
  outline: none;
  border-color: var(--focus);
}

.slider-caption {
  margin: 0;
  font-size: 12px;
  color: var(--ink);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.slider-subject {
  color: var(--focus);
  font-weight: 600;
  text-decoration: none;
}
.slider-subject:hover { text-decoration: underline; }

.slider-text { color: var(--muted); font-style: italic; }

.slider-thumbs {
  display: flex;
  gap: 4px;
  padding: 6px 8px;
  overflow-x: auto;
  overflow-y: hidden;
  scroll-behavior: smooth;
  border-top: 1px solid var(--rule);
  background: var(--paper-raised);
  scrollbar-width: thin;
  -webkit-overflow-scrolling: touch;
}

.slider-thumb {
  flex: 0 0 auto;
  width: 64px;
  height: 48px;
  padding: 0;
  border: 2px solid transparent;
  border-radius: 4px;
  background: #000;
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.15s, opacity 0.15s;
  opacity: 0.65;
}
.slider-thumb:hover { opacity: 1; }
.slider-thumb.active {
  border-color: var(--focus);
  opacity: 1;
}
.slider-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
</style>
