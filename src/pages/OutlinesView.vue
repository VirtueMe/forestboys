<template>
  <div class="outlines-page">
    <!-- Search -->
    <div class="search-wrap">
      <input
        v-model="query"
        class="search-input"
        type="search"
        placeholder="Søk etter informasjon…"
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
      <div v-if="loading" class="status">Laster…</div>

      <div v-else-if="filtered.length === 0 && query.length >= 2" class="status">
        Ingen treff for «{{ query }}»
      </div>

      <div v-else :style="{ height: totalHeight + 'px', position: 'relative' }">
        <div :style="{ transform: `translateY(${offsetY}px)` }">
          <RouterLink
            v-for="item in visibleItems"
            :key="item.slug"
            :to="`/outlines/${item.slug}`"
            class="outline-row"
          >
            <img
              v-if="item.thumbnailUrl"
              :src="`${item.thumbnailUrl.replace(/\?.*$/, '')}?w=80&h=80&fit=crop&auto=format`"
              class="outline-thumb"
              loading="lazy"
              alt=""
            />
            <span v-else class="outline-thumb-placeholder"></span>
            <span class="outline-title">{{ item.title }}</span>
          </RouterLink>
        </div>
      </div>
    </div>

    <!-- Count bar -->
    <div class="count-bar">
      <span v-if="query.length >= 2">
        Viser {{ fmt(filtered.length) }} av {{ fmt(outlines.length) }} oppføringer
      </span>
      <span v-else>Viser {{ fmt(outlines.length) }} oppføringer</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { RouterLink } from 'vue-router'
import { useLocationCache } from '../composables/useLocationCache.ts'

const { outlines, loading, init } = useLocationCache()

onMounted(async () => {
  await init()
  if (containerRef.value) {
    ro = new ResizeObserver(entries => {
      containerHeight.value = entries[0].contentRect.height
    })
    ro.observe(containerRef.value)
  }
})

const query = ref('')

const filtered = computed(() => {
  if (query.value.length < 2) return outlines.value
  const q = query.value.toLowerCase()
  return outlines.value.filter(o => o.title.toLowerCase().includes(q))
})

watch(query, () => {
  scrollTop.value = 0
  if (containerRef.value) containerRef.value.scrollTop = 0
})

const ITEM_HEIGHT = 64
const BUFFER      = 5
const scrollTop       = ref(0)
const containerHeight = ref(0)
const containerRef    = ref<HTMLElement | null>(null)
let ro: ResizeObserver | null = null

const visibleRange = computed(() => {
  const start = Math.max(0, Math.floor(scrollTop.value / ITEM_HEIGHT) - BUFFER)
  const end   = Math.min(
    filtered.value.length,
    Math.ceil((scrollTop.value + containerHeight.value) / ITEM_HEIGHT) + BUFFER,
  )
  return { start, end }
})

const visibleItems = computed(() => filtered.value.slice(visibleRange.value.start, visibleRange.value.end))
const totalHeight  = computed(() => filtered.value.length * ITEM_HEIGHT)
const offsetY      = computed(() => visibleRange.value.start * ITEM_HEIGHT)

onUnmounted(() => ro?.disconnect())

function fmt(n: number): string {
  return n.toLocaleString('nb-NO')
}
</script>

<style scoped>
.outlines-page {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  background: var(--color-bg);
}

.outlines-page > * {
  width: 100%;
  max-width: 1320px;
}

.search-wrap {
  flex-shrink: 0;
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
}

.search-input {
  width: 100%;
  height: 32px;
  padding: 0 10px;
  background: var(--color-bg);
  border: 1px solid var(--color-border-mid);
  border-radius: 6px;
  font-size: 13px;
  color: var(--color-text);
  outline: none;
  box-sizing: border-box;
  -webkit-appearance: none;
}
.search-input::placeholder { color: var(--color-muted); }
.search-input:focus { border-color: var(--color-navy); }

.scroll-container {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  background: var(--color-surface);
}

.status {
  padding: 32px 20px;
  text-align: center;
  font-size: 13px;
  color: var(--color-muted);
}

.outline-row {
  display: flex;
  align-items: center;
  height: 64px;
  padding: 0 14px;
  gap: 10px;
  text-decoration: none;
  color: var(--color-text);
  border-bottom: 1px solid var(--color-border);
  box-sizing: border-box;
  transition: background 0.1s;
}
.outline-row:hover { background: var(--color-bg); }

.outline-thumb {
  width: 44px;
  height: 44px;
  object-fit: cover;
  border-radius: 3px;
  flex-shrink: 0;
}

.outline-thumb-placeholder {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
}

.outline-title {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-navy);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.count-bar {
  flex-shrink: 0;
  padding: 6px 14px;
  background: var(--color-surface);
  border-top: 1px solid var(--color-border);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--color-muted);
}
</style>
