<template>
  <div class="person-page">
    <div v-if="loading" class="status">Laster…</div>

    <div v-else-if="!person" class="status">Person ikke funnet.</div>

    <template v-else>
      <!-- Hero image -->
      <div v-if="heroUrl" class="hero">
        <img :src="heroUrl" :alt="person.name" class="hero-img" />
      </div>

      <!-- Header -->
      <div class="page-header">
        <RouterLink to="/registre" class="back-link">&#x2039; Tilbake</RouterLink>
        <h1 class="person-name">{{ person.name }}</h1>
        <p v-if="person.secretName" class="person-alias">Dekknavn: {{ person.secretName }}</p>
        <p v-if="meta" class="person-meta">{{ meta }}</p>
      </div>

      <!-- Beskrivelse -->
      <section v-if="person.description" class="section">
        <h3 class="section-heading">Beskrivelse</h3>
        <p class="plain-text">{{ person.description }}</p>
      </section>

      <!-- Hendelser -->
      <section v-if="person.events?.length" class="section">
        <div class="section-header-row">
          <h3 class="section-heading">Hendelser ({{ person.events.length }})</h3>
          <button class="sort-btn" @click="eventSortAsc = !eventSortAsc">
            Dato {{ eventSortAsc ? '↑' : '↓' }}
          </button>
        </div>
        <div class="link-list">
          <RouterLink
            v-for="event in sortedEvents"
            :key="event.slug"
            :to="`/events/${event.slug}`"
            class="event-item"
          >
            <span class="event-date">{{ formatDate(event.date) }}</span>
            <span class="event-title">{{ event.title }}</span>
          </RouterLink>
        </div>
      </section>

      <!-- Steder -->
      <section v-if="person.locations?.length" class="section">
        <h3 class="section-heading">Vært stasjonert på</h3>
        <div class="link-list">
          <RouterLink
            v-for="loc in person.locations"
            :key="loc.slug"
            :to="`/map/${loc.slug}`"
            class="section-link"
          >
            {{ loc.title }}
          </RouterLink>
        </div>
      </section>

      <!-- Baser -->
      <section v-if="person.stations?.length" class="section">
        <h3 class="section-heading">Gjennomgått trening på</h3>
        <div class="link-list">
          <RouterLink
            v-for="s in person.stations"
            :key="s.slug"
            :to="`/station/${s.slug}`"
            class="section-link"
          >
            {{ s.title }}
          </RouterLink>
        </div>
      </section>

      <!-- Annen informasjon -->
      <section v-if="outlines.length" class="section">
        <h3 class="section-heading">Annen informasjon</h3>
        <div class="link-list">
          <RouterLink
            v-for="o in outlines"
            :key="o.slug"
            :to="`/outlines/${o.slug}`"
            class="section-link"
          >
            {{ o.title }}
          </RouterLink>
        </div>
      </section>

      <!-- Video -->
      <section v-if="person.movie" class="section">
        <h3 class="section-heading">Video</h3>
        <video controls class="video-player">
          <source :src="person.movie" type="video/mp4" />
        </video>
      </section>

      <!-- Galleri -->
      <section v-if="person.gallery?.length" class="section">
        <h3 class="section-heading">Galleri</h3>
        <div class="carousel">
          <button v-if="person.gallery.length > 1" class="carousel-btn" @click="prevImage">&#x2039;</button>
          <img
            :src="currentImageUrl"
            :alt="`${person.name} bilde ${currentImageIndex + 1}`"
            class="carousel-img"
          />
          <button v-if="person.gallery.length > 1" class="carousel-btn" @click="nextImage">&#x203a;</button>
        </div>
        <p v-if="person.gallery.length > 1" class="carousel-count">
          {{ currentImageIndex + 1 }} / {{ person.gallery.length }}
        </p>
        <p v-if="currentCaption" class="carousel-caption">{{ currentCaption }}</p>
      </section>

      <!-- Lenker -->
      <section v-if="person.links?.length" class="section">
        <h3 class="section-heading">Nyttige lenker</h3>
        <div class="link-list">
          <a
            v-for="link in person.links"
            :key="link.url"
            :href="link.url"
            target="_blank"
            rel="noopener noreferrer"
            class="ext-link"
          >{{ link.title || link.url }} <span class="ext-icon">↗</span></a>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { useLocationCache } from '../composables/useLocationCache.ts'
import { SANITY_IMG } from '../config/sanity.ts'

const route = useRoute()
const { people, loading, init } = useLocationCache()

onMounted(async () => { await init() })

const person = computed(() =>
  people.value.find(p => p.slug === (route.params.slug as string)) ?? null,
)

const meta = computed(() => {
  if (!person.value) return null
  const parts: string[] = []
  if (person.value.birthYear) parts.push(`f. ${person.value.birthYear}`)
  if (person.value.home) parts.push(person.value.home)
  return parts.join(' · ') || null
})

const MONTHS = ['januar','februar','mars','april','mai','juni','juli','august','september','oktober','november','desember']

function formatDate(iso?: string): string {
  if (!iso) return '–'
  const [y, m, d] = iso.split('-').map(Number)
  return `${d}. ${MONTHS[m - 1]} ${y}`
}

const eventSortAsc = ref(true)

const sortedEvents = computed(() => {
  const evts = [...(person.value?.events ?? [])]
  return eventSortAsc.value
    ? evts.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
    : evts.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
})

const outlines = computed<{ title: string; slug: string }[]>(() => {
  const raw = person.value?.outlines
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (o): o is { title: string; slug: string } =>
      o !== null && typeof o === 'object' &&
      typeof (o as Record<string, unknown>).title === 'string' &&
      typeof (o as Record<string, unknown>).slug === 'string',
  )
})

const heroUrl = computed<string | null>(() => {
  const thumb = person.value?.thumbnailUrl
  if (!thumb) return null
  return thumb.replace(/\?.*$/, '') + '?w=900&h=500&fit=crop&auto=format'
})

// Gallery carousel
const currentImageIndex = ref(0)

const currentImageUrl = computed<string>(() => {
  const g = person.value?.gallery
  if (!g?.length) return ''
  const assetRef = (g[currentImageIndex.value].asset as { _ref: string })._ref
  const path = assetRef.replace(/^image-/, '').replace(/-([a-z]+)$/, '.$1')
  return `${SANITY_IMG}/${path}?w=900&auto=format`
})

const currentCaption = computed<string | null>(() =>
  person.value?.gallery?.[currentImageIndex.value]?.caption ?? null,
)

function prevImage() {
  const len = person.value?.gallery?.length ?? 0
  currentImageIndex.value = (currentImageIndex.value - 1 + len) % len
}

function nextImage() {
  const len = person.value?.gallery?.length ?? 0
  currentImageIndex.value = (currentImageIndex.value + 1) % len
}
</script>

<style scoped>
.person-page {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: var(--color-bg);
  display: flex;
  flex-direction: column;
  align-items: center;
}

.person-page > * {
  width: 100%;
  max-width: 1320px;
}

/* ── Status ─────────────────────────────────────────────────── */
.status {
  padding: 48px 20px;
  text-align: center;
  font-size: 13px;
  color: var(--color-muted);
}

/* ── Hero ───────────────────────────────────────────────────── */
.hero {
  width: 100%;
  overflow: hidden;
}

.hero-img {
  width: 100%;
  height: 340px;
  object-fit: cover;
  object-position: center 20%;
  display: block;
}

/* ── Page header ────────────────────────────────────────────── */
.page-header {
  padding: 14px 16px 12px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.back-link {
  display: inline-block;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-navy);
  text-decoration: none;
  margin-bottom: 10px;
}
.back-link:hover { text-decoration: underline; }

.person-name {
  font-size: 22px;
  font-weight: 700;
  color: var(--color-text);
  margin: 0 0 4px;
  line-height: 1.25;
}

.person-alias {
  font-size: 13px;
  color: var(--color-muted);
  font-style: italic;
  margin: 0 0 2px;
}

.person-meta {
  font-size: 12px;
  color: var(--color-muted);
  margin: 0;
}

/* ── Sections ───────────────────────────────────────────────── */
.section {
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
}

.section + .section {
  border-top: none;
}

.section-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.section-heading {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--color-muted);
  margin: 0;
}

.sort-btn {
  background: none;
  border: 1px solid var(--color-border-mid);
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-muted);
  padding: 2px 8px;
  cursor: pointer;
  white-space: nowrap;
}
.sort-btn:hover { border-color: var(--color-navy); color: var(--color-navy); }

/* ── Description ────────────────────────────────────────────── */
.plain-text {
  font-size: 14px;
  line-height: 1.75;
  color: var(--color-text);
  margin: 0;
  white-space: pre-line;
}

/* ── Link list ──────────────────────────────────────────────── */
.link-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.section-link {
  display: block;
  font-size: 13px;
  color: var(--color-navy);
  text-decoration: none;
  padding: 2px 0;
}
.section-link:hover { text-decoration: underline; }

/* ── Event items ────────────────────────────────────────────── */
.event-item {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 6px 8px;
  margin: 0 -8px;
  text-decoration: none;
  color: var(--color-text);
  border-bottom: 1px solid var(--color-border);
  border-radius: 4px;
  transition: background 0.1s;
}
.event-item:last-child { border-bottom: none; }
.event-item:hover { background: var(--color-bg); }
.event-item:hover .event-title { text-decoration: underline; }

.event-date {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  flex-shrink: 0;
}

.event-title {
  font-size: 13px;
  color: var(--color-navy);
  flex: 1;
  min-width: 0;
}

/* ── External links ─────────────────────────────────────────── */
.ext-link {
  display: block;
  font-size: 13px;
  color: var(--color-navy);
  text-decoration: none;
  padding: 2px 0;
  word-break: break-all;
}
.ext-link:hover { text-decoration: underline; }
.ext-icon { font-size: 11px; opacity: 0.6; }

/* ── Video ──────────────────────────────────────────────────── */
.video-player {
  width: 100%;
  border-radius: 4px;
  display: block;
}

/* ── Carousel ───────────────────────────────────────────────── */
.carousel {
  display: flex;
  align-items: center;
  gap: 8px;
}

.carousel-img {
  flex: 1;
  width: 100%;
  max-height: 320px;
  object-fit: contain;
  display: block;
  border-radius: 4px;
  background: var(--color-border);
}

.carousel-btn {
  background: none;
  border: 1px solid var(--color-border);
  border-radius: 50%;
  width: 32px;
  height: 32px;
  font-size: 20px;
  color: var(--color-navy);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  line-height: 1;
}
.carousel-btn:hover { border-color: var(--color-border-mid); }

.carousel-count {
  font-size: 11px;
  color: var(--color-muted);
  text-align: center;
  margin: 6px 0 0;
}

.carousel-caption {
  font-size: 12px;
  color: var(--color-muted);
  text-align: center;
  margin: 4px 0 0;
  font-style: italic;
}
</style>
