<template>
  <div class="registre-page">
    <!-- Filters -->
    <div class="filters">
      <input
        v-model="query"
        class="search-input"
        type="search"
        placeholder="Søk i registre…"
        autocomplete="off"
        spellcheck="false"
      />
      <CustomSelect
        :model-value="selectedTypes"
        :options="TYPE_OPTIONS"
        :color-map="TYPE_COLORS"
        placeholder="Alle typer"
        :multiple="true"
        @update:model-value="selectedTypes = ($event as string[])"
      />
    </div>

    <!-- List -->
    <div
      ref="containerRef"
      class="scroll-container"
      @scroll="scrollTop = ($event.target as HTMLElement).scrollTop"
    >
      <div v-if="loading" class="status">Laster registre…</div>

      <div v-else-if="filtered.length === 0" class="status">
        <span v-if="query || selectedTypes.length < TYPE_OPTIONS.length">Ingen treff.</span>
        <span v-else>Ingen oppføringer funnet.</span>
      </div>

      <div v-else :style="{ height: totalHeight + 'px', position: 'relative' }">
        <div :style="{ transform: `translateY(${offsetY}px)` }">
          <RouterLink
            v-for="item in visibleItems"
            :key="`${item.type}-${item.slug}`"
            :to="item.route"
            class="entry-row"
          >
            <!-- Thumbnail -->
            <div :class="['entry-thumb', item.type === 'person' ? 'entry-thumb--circle' : '']">
              <img
                v-if="item.thumbnailUrl"
                :src="`${item.thumbnailUrl.replace(/\?.*$/, '')}?w=80&h=80&fit=crop&auto=format`"
                :alt="item.name"
                loading="lazy"
              />
              <span v-else-if="item.type === 'person'" class="entry-thumb-initials">{{ initials(item.name) }}</span>
            </div>

            <span class="entry-type" :style="{ background: TYPE_COLORS[item.label] }">{{ item.label.slice(0, 1) }}</span>
            <span class="entry-name">{{ item.name }}</span>
          </RouterLink>
        </div>
      </div>
    </div>

    <!-- Count bar -->
    <div class="count-bar">
      <span v-if="query || selectedTypes.length < TYPE_OPTIONS.length">
        Viser {{ fmt(filtered.length) }} av {{ fmt(allEntries.length) }} oppføringer
      </span>
      <span v-else>{{ fmt(allEntries.length) }} oppføringer</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { RouterLink } from 'vue-router'
import { useLocationCache } from '../composables/useLocationCache.ts'
import CustomSelect from '../components/CustomSelect.vue'

const { stations, people, transport, outlines, loading, init } = useLocationCache()

onMounted(async () => {
  await init()
  if (containerRef.value) {
    ro = new ResizeObserver(entries => {
      containerHeight.value = entries[0].contentRect.height
    })
    ro.observe(containerRef.value)
  }
})

// ── Type config ───────────────────────────────────────────────
const TYPE_OPTIONS = ['Stasjon', 'Person', 'Fremkomstmiddel', 'Informasjon']

const TYPE_COLORS: Record<string, string> = {
  Stasjon:         'var(--color-navy)',
  Person:          'var(--color-green)',
  Fremkomstmiddel: 'var(--color-red)',
  Informasjon:     'var(--color-muted)',
}

const TYPE_KEY: Record<string, string> = {
  Stasjon:         'station',
  Person:          'person',
  Fremkomstmiddel: 'transport',
  Informasjon:     'outline',
}

// ── Filters ───────────────────────────────────────────────────
const query         = ref('')
const selectedTypes = ref<string[]>([...TYPE_OPTIONS])

watch([query, selectedTypes], () => {
  scrollTop.value = 0
  if (containerRef.value) containerRef.value.scrollTop = 0
})

// ── Combined + sorted entries ─────────────────────────────────
interface Entry {
  type:         string
  label:        string
  name:         string
  slug:         string
  route:        string
  thumbnailUrl?: string
}

const allEntries = computed<Entry[]>(() => {
  const entries: Entry[] = [
    ...stations.value.map(s => ({
      type: 'station', label: 'Stasjon',
      name: s.title, slug: s.slug, route: `/station/${s.slug}`,
      thumbnailUrl: s.thumbnailUrl,
    })),
    ...people.value.map(p => ({
      type: 'person', label: 'Person',
      name: p.name, slug: p.slug, route: `/person/${p.slug}`,
      thumbnailUrl: p.thumbnailUrl,
    })),
    ...transport.value.map(t => ({
      type: 'transport', label: 'Fremkomstmiddel',
      name: t.name, slug: t.slug, route: `/transport/${t.slug}`,
      thumbnailUrl: t.thumbnailUrl,
    })),
    ...outlines.value.map(o => ({
      type: 'outline', label: 'Informasjon',
      name: o.title, slug: o.slug, route: `/outlines/${o.slug}`,
      thumbnailUrl: o.thumbnailUrl,
    })),
  ]
  return entries.sort((a, b) => a.name.localeCompare(b.name, 'nb'))
})

const filtered = computed<Entry[]>(() => {
  const activeKeys = new Set(selectedTypes.value.map(t => TYPE_KEY[t]))
  let r = allEntries.value.filter(e => activeKeys.has(e.type))
  if (query.value.length >= 2) {
    const q = query.value.toLowerCase()
    r = r.filter(e => e.name.toLowerCase().includes(q))
  }
  return r
})

// ── Virtual scroll ────────────────────────────────────────────
const ITEM_HEIGHT = 64
const BUFFER      = 8
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

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase()
}

function fmt(n: number): string {
  return n.toLocaleString('nb-NO')
}
</script>

<style scoped>
.registre-page {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  background: var(--color-bg);
}

.registre-page > * {
  width: 100%;
  max-width: 1320px;
}

/* ── Filters ─────────────────────────────────────────────────── */
.filters {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
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

/* ── Scroll container ───────────────────────────────────────── */
.scroll-container {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  background: var(--color-surface);
}

/* ── Status ─────────────────────────────────────────────────── */
.status {
  padding: 32px 20px;
  text-align: center;
  font-size: 13px;
  color: var(--color-muted);
}

/* ── Entry row ──────────────────────────────────────────────── */
.entry-row {
  display: flex;
  align-items: center;
  height: 64px;
  padding: 0 14px;
  gap: 12px;
  text-decoration: none;
  color: var(--color-text);
  border-bottom: 1px solid var(--color-border);
  box-sizing: border-box;
  transition: background 0.1s;
}
.entry-row:hover { background: var(--color-bg); }
.entry-row:hover .entry-name { text-decoration: underline; }

/* ── Thumbnail ──────────────────────────────────────────────── */
.entry-thumb {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  border-radius: 3px;
  overflow: hidden;
  background: var(--color-border);
}

.entry-thumb--circle {
  border-radius: 50%;
}

.entry-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.entry-thumb-initials {
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

.entry-type {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.03em;
  white-space: nowrap;
  color: #fff;
  text-transform: uppercase;
}

.entry-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Count bar ──────────────────────────────────────────────── */
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
