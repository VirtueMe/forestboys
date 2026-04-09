<template>
  <div class="people-page">
    <!-- Search -->
    <div class="search-wrap">
      <input
        v-model="query"
        class="search-input"
        type="search"
        placeholder="Søk etter person…"
        autocomplete="off"
        autocorrect="off"
        spellcheck="false"
      />
    </div>

    <!-- Virtual scroll container -->
    <div
      ref="containerRef"
      class="scroll-container"
      @scroll="scrollTop = ($event.target as HTMLElement).scrollTop"
    >
      <!-- Loading -->
      <div v-if="loading" class="status">Laster personer…</div>

      <!-- No results -->
      <div v-else-if="filteredPeople.length === 0 && query.length >= 2" class="status">
        Ingen treff for «{{ query }}»
      </div>

      <!-- Virtual list -->
      <div v-else :style="{ height: totalHeight + 'px', position: 'relative' }">
        <div :style="{ transform: `translateY(${offsetY}px)` }">
          <router-link
            v-for="person in visiblePeople"
            :key="person.slug"
            :to="`/person/${person.slug}`"
            class="person-row"
          >
            <!-- Thumbnail -->
            <div class="thumb">
              <img
                v-if="person.thumbnailUrl"
                :src="thumbSrc(person.thumbnailUrl)"
                :alt="person.name"
                loading="lazy"
              />
              <div v-else class="thumb-placeholder">{{ initials(person.name) }}</div>
            </div>

            <!-- Info -->
            <div class="info">
              <div class="row-top">
                <span class="name">{{ person.name }}</span>
                <span v-if="person.home" class="home">{{ person.home }}</span>
              </div>
              <div v-if="person.birthYear || person.secretName" class="row-bottom">
                <span v-if="person.birthYear" class="meta">{{ person.birthYear }}</span>
                <span v-if="person.birthYear && person.secretName" class="sep">·</span>
                <span v-if="person.secretName" class="meta secret">{{ person.secretName }}</span>
              </div>
            </div>
          </router-link>
        </div>
      </div>
    </div>

    <!-- Count bar -->
    <div class="count-bar">
      <span v-if="query.length >= 2">
        Viser {{ fmt(filteredPeople.length) }} av {{ fmt(sortedPeople.length) }} personer
      </span>
      <span v-else>Viser {{ fmt(sortedPeople.length) }} personer</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useLocationCache } from '../composables/useLocationCache.ts'

const { people, loading, init } = useLocationCache()

const query = ref('')
const scrollTop = ref(0)
const containerHeight = ref(0)
const containerRef = ref<HTMLElement | null>(null)

const ITEM_HEIGHT = 64
const BUFFER = 5

const sortedPeople = computed(() =>
  [...people.value].sort((a, b) => a.name.localeCompare(b.name, 'nb')),
)

const filteredPeople = computed(() => {
  if (query.value.length < 2) return sortedPeople.value
  const q = query.value.toLowerCase()
  return sortedPeople.value.filter(p =>
    p.name.toLowerCase().includes(q) ||
    (p.secretName?.toLowerCase().includes(q) ?? false),
  )
})

const visibleRange = computed(() => {
  const start = Math.max(0, Math.floor(scrollTop.value / ITEM_HEIGHT) - BUFFER)
  const end = Math.min(
    filteredPeople.value.length,
    Math.ceil((scrollTop.value + containerHeight.value) / ITEM_HEIGHT) + BUFFER,
  )
  return { start, end }
})

const visiblePeople = computed(() =>
  filteredPeople.value.slice(visibleRange.value.start, visibleRange.value.end),
)

const totalHeight = computed(() => filteredPeople.value.length * ITEM_HEIGHT)
const offsetY = computed(() => visibleRange.value.start * ITEM_HEIGHT)

watch(query, () => {
  scrollTop.value = 0
  if (containerRef.value) containerRef.value.scrollTop = 0
})

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase()
}

function thumbSrc(url: string): string {
  return url.replace(/\?.*$/, '?w=80&h=80&fit=crop&auto=format')
}

function fmt(n: number): string {
  return n.toLocaleString('nb-NO')
}

let ro: ResizeObserver | null = null

onMounted(async () => {
  if (containerRef.value) {
    ro = new ResizeObserver(entries => {
      containerHeight.value = entries[0].contentRect.height
    })
    ro.observe(containerRef.value)
  }
  await init()
})

onUnmounted(() => ro?.disconnect())
</script>

<style scoped>
.people-page {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  background: var(--color-bg);
}

.people-page > * {
  width: 100%;
  max-width: 1320px;
}

/* ── Search ─────────────────────────────────────────────────── */
.search-wrap {
  flex-shrink: 0;
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
}

.search-input {
  width: 100%;
  height: 36px;
  padding: 0 12px;
  background: var(--color-bg);
  border: 1px solid var(--color-border-mid);
  border-radius: 6px;
  font-size: 14px;
  color: var(--color-text);
  outline: none;
  -webkit-appearance: none;
}

.search-input::placeholder { color: var(--color-muted); }
.search-input:focus { border-color: var(--color-navy); }

/* ── Scroll container ───────────────────────────────────────── */
.scroll-container {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  background: var(--color-surface);
}

/* ── Status messages ────────────────────────────────────────── */
.status {
  padding: 32px 20px;
  text-align: center;
  font-size: 13px;
  color: var(--color-muted);
}

/* ── Person row ─────────────────────────────────────────────── */
.person-row {
  display: flex;
  align-items: center;
  height: 64px;          /* ITEM_HEIGHT — must be exact */
  padding: 0 14px;
  gap: 12px;
  text-decoration: none;
  color: var(--color-text);
  border-bottom: 1px solid var(--color-border);
  box-sizing: border-box;
  transition: background 0.1s;
}

.person-row:hover {
  background: var(--color-bg);
}

/* ── Thumbnail ──────────────────────────────────────────────── */
.thumb {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: 50%;
  overflow: hidden;
  background: var(--color-border);
}

.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.thumb-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-navy);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

/* ── Info ───────────────────────────────────────────────────── */
.info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
}

.row-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.home {
  font-size: 11px;
  color: var(--color-muted);
  white-space: nowrap;
  flex-shrink: 0;
}

.row-bottom {
  display: flex;
  align-items: center;
  gap: 4px;
}

.meta {
  font-size: 11px;
  color: var(--color-muted);
}

.secret {
  font-style: italic;
}

.sep {
  font-size: 11px;
  color: var(--color-handle);
}

/* ── Count bar ──────────────────────────────────────────────── */
.count-bar {
  flex-shrink: 0;
  padding: 8px 14px;
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
  font-size: 11px;
  color: var(--color-muted);
}
</style>
