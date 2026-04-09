<template>
  <div class="station-detail">
    <div v-if="loading" class="status">Laster…</div>

    <div v-else-if="!item" class="status">Stasjon ikke funnet.</div>

    <template v-else>
      <!-- Hero image -->
      <div v-if="heroUrl" class="hero">
        <img :src="heroUrl" :alt="item.title" class="hero-img" />
      </div>

      <!-- Header -->
      <div class="page-header">
        <RouterLink to="/registre" class="back-link">&#x2039; Tilbake</RouterLink>
        <h1 class="item-title">{{ item.title }}</h1>
        <p v-if="item.type" class="item-meta">{{ item.type }}</p>
      </div>

      <!-- Beskrivelse -->
      <section v-if="item.description" class="section">
        <h3 class="section-heading">Beskrivelse</h3>
        <p class="plain-text">{{ item.description }}</p>
      </section>

      <!-- Hendelser -->
      <section v-if="item.events?.length" class="section">
        <div class="section-header-row">
          <h3 class="section-heading">Hendelser som skjedde her ({{ item.events.length }})</h3>
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

      <!-- Deltakere -->
      <section v-if="item.people?.length" class="section">
        <h3 class="section-heading">Deltakere her ({{ item.people.length }})</h3>
        <div class="link-list">
          <RouterLink
            v-for="person in item.people"
            :key="person.slug"
            :to="`/person/${person.slug}`"
            class="section-link"
          >
            {{ person.name }}
          </RouterLink>
        </div>
      </section>

      <!-- Galleri -->
      <section v-if="item.gallery?.length" class="section">
        <h3 class="section-heading">Galleri</h3>
        <div class="carousel">
          <button v-if="item.gallery.length > 1" class="carousel-btn" @click="prevImage">&#x2039;</button>
          <img
            :src="currentImageUrl"
            :alt="`${item.title} bilde ${currentImageIndex + 1}`"
            class="carousel-img"
          />
          <button v-if="item.gallery.length > 1" class="carousel-btn" @click="nextImage">&#x203a;</button>
        </div>
        <p v-if="item.gallery.length > 1" class="carousel-count">
          {{ currentImageIndex + 1 }} / {{ item.gallery.length }}
        </p>
        <p v-if="currentCaption" class="carousel-caption">{{ currentCaption }}</p>
      </section>

      <!-- Video -->
      <section v-if="item.movie" class="section">
        <h3 class="section-heading">Video</h3>
        <video controls class="video-player">
          <source :src="item.movie" type="video/mp4" />
        </video>
      </section>

      <!-- Lenker -->
      <section v-if="item.links?.length" class="section">
        <h3 class="section-heading">Nyttige lenker</h3>
        <div class="link-list">
          <a
            v-for="link in item.links"
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
const { stations, loading, init } = useLocationCache()

onMounted(async () => { await init() })

const item = computed(() =>
  stations.value.find(s => s.slug === (route.params.slug as string)) ?? null,
)

const heroUrl = computed<string | null>(() => {
  const thumb = item.value?.thumbnailUrl
  if (!thumb) return null
  return thumb.replace(/\?.*$/, '') + '?w=900&h=500&fit=crop&auto=format'
})

const MONTHS = ['januar','februar','mars','april','mai','juni','juli','august','september','oktober','november','desember']

function formatDate(iso?: string): string {
  if (!iso) return '–'
  const [y, m, d] = iso.split('-').map(Number)
  return `${d}. ${MONTHS[m - 1]} ${y}`
}

const eventSortAsc = ref(true)

const sortedEvents = computed(() => {
  const evts = [...(item.value?.events ?? [])]
  return eventSortAsc.value
    ? evts.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
    : evts.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
})

const currentImageIndex = ref(0)

const currentImageUrl = computed<string>(() => {
  const g = item.value?.gallery
  if (!g?.length) return ''
  const assetRef = (g[currentImageIndex.value].asset as { _ref: string })._ref
  const path = assetRef.replace(/^image-/, '').replace(/-([a-z]+)$/, '.$1')
  return `${SANITY_IMG}/${path}?w=900&auto=format`
})

const currentCaption = computed<string | null>(() =>
  item.value?.gallery?.[currentImageIndex.value]?.caption ?? null,
)

function prevImage() {
  const len = item.value?.gallery?.length ?? 0
  currentImageIndex.value = (currentImageIndex.value - 1 + len) % len
}

function nextImage() {
  const len = item.value?.gallery?.length ?? 0
  currentImageIndex.value = (currentImageIndex.value + 1) % len
}
</script>

<style scoped>
.station-detail {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: var(--color-bg);
  display: flex;
  flex-direction: column;
  align-items: center;
}

.station-detail > * {
  width: 100%;
  max-width: 1320px;
}

.status {
  padding: 48px 20px;
  text-align: center;
  font-size: 13px;
  color: var(--color-muted);
}

.hero { width: 100%; overflow: hidden; }

.hero-img {
  width: 100%;
  height: 340px;
  object-fit: cover;
  object-position: center 20%;
  display: block;
}

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

.item-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--color-text);
  margin: 0 0 4px;
  line-height: 1.25;
}

.item-meta {
  font-size: 12px;
  color: var(--color-muted);
  margin: 0;
}

.section {
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
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
}
.sort-btn:hover { border-color: var(--color-navy); color: var(--color-navy); }

.plain-text {
  font-size: 14px;
  line-height: 1.75;
  color: var(--color-text);
  margin: 0;
  white-space: pre-line;
}

.link-list { display: flex; flex-direction: column; gap: 2px; }

.section-link {
  display: block;
  font-size: 13px;
  color: var(--color-navy);
  text-decoration: none;
  padding: 2px 0;
}
.section-link:hover { text-decoration: underline; }

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

.carousel { display: flex; align-items: center; gap: 8px; }

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

.video-player { width: 100%; border-radius: 4px; display: block; }
</style>
