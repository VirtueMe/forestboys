<template>
  <div class="event-page">
    <button class="back-btn" @click="router.back()">&#x2039; Tilbake</button>

    <div v-if="loading" class="status">Laster hendelse…</div>
    <div v-else-if="error" class="status error">Hendelsen ble ikke funnet.</div>

    <template v-else-if="event">
      <!-- Timeline.js section -->
      <section class="timeline-section">
        <h2 class="timeline-heading">Tidslinjeutforsker</h2>
        <div class="timeline-filters">
          <select class="filter-select">
            <option>Alle Organisasjoner</option>
          </select>
          <select class="filter-select">
            <option>Alle Avdelinger</option>
          </select>
        </div>
        <div class="timeline-placeholder">
          <!-- Timeline.js widget — implement when TimelineView is built -->
        </div>
      </section>

      <hr class="divider" />

      <!-- Article -->
      <article class="article">
        <h2 class="event-title">{{ event.title }}</h2>

        <!-- Beskrivelse -->
        <section v-if="event.description?.length" class="section">
          <h2 class="section-heading">Beskrivelse</h2>
          <div
            class="portable-text"
            @click.capture="handleInternalLinks"
            v-html="blocksToHtml(event.description)"
          ></div>
        </section>

        <!-- Fra Sted -->
        <section v-if="event.locationFrom" class="section">
          <h2 class="section-heading">Fra Sted</h2>
          <RouterLink :to="`/map/${event.locationFrom.slug}`" class="section-link">
            {{ event.locationFrom.title }}
          </RouterLink>
        </section>

        <!-- Til Sted -->
        <section v-if="event.locationTo" class="section">
          <h2 class="section-heading">Til Sted</h2>
          <RouterLink :to="`/map/${event.locationTo.slug}`" class="section-link">
            {{ event.locationTo.title }}
          </RouterLink>
        </section>

        <!-- Fra Base -->
        <section v-if="event.stationFrom || event.stationTo" class="section">
          <h2 class="section-heading">Fra Base</h2>
          <RouterLink v-if="event.stationFrom" :to="`/station/${event.stationFrom.slug}`" class="section-link">
            {{ event.stationFrom.title }}
          </RouterLink>
          <RouterLink v-if="event.stationTo" :to="`/station/${event.stationTo.slug}`" class="section-link">
            {{ event.stationTo.title }}
          </RouterLink>
        </section>

        <!-- Deltakere -->
        <section v-if="event.people?.length" class="section">
          <h2 class="section-heading">Deltakere</h2>
          <div class="people-list">
            <RouterLink
              v-for="person in event.people"
              :key="person.slug"
              :to="`/person/${person.slug}`"
              class="section-link"
            >
              {{ person.name }}
            </RouterLink>
          </div>
        </section>

        <!-- Transportmiddel -->
        <section v-if="event.transport?.length" class="section">
          <h2 class="section-heading">Transportmiddel</h2>
          <div class="transport-list">
            <RouterLink
              v-for="t in event.transport"
              :key="t.slug"
              :to="`/transport/${t.slug}`"
              class="section-link"
            >
              {{ t.name }}
            </RouterLink>
          </div>
        </section>

        <!-- Galleri -->
        <section v-if="event.gallery?.length" class="section">
          <h2 class="section-heading">Galleri</h2>
          <div class="carousel">
            <button
              v-if="event.gallery.length > 1"
              class="carousel-btn carousel-prev"
              @click="prevImage"
            >
              &#x2039;
            </button>
            <img
              :src="currentImageUrl"
              :alt="`${event.title} bilde ${currentImageIndex + 1}`"
              class="carousel-img"
            />
            <button
              v-if="event.gallery.length > 1"
              class="carousel-btn carousel-next"
              @click="nextImage"
            >
              &#x203a;
            </button>
          </div>
          <p v-if="event.gallery.length > 1" class="carousel-count">
            {{ currentImageIndex + 1 }} / {{ event.gallery.length }}
          </p>
        </section>

        <!-- Nyttige lenker -->
        <section v-if="event.links?.length" class="section">
          <h2 class="section-heading">Nyttige lenker</h2>
          <div class="links-list">
            <a
              v-for="link in event.links"
              :key="link.link"
              :href="link.link"
              target="_blank"
              rel="noopener noreferrer"
              class="ext-link"
            >{{ link.title || link.link }} <span class="ext-icon">↗</span></a>
          </div>
        </section>
      </article>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { fetchEventDetailBySlug } from '../composables/useLocationCache.ts'
import { SANITY_IMG } from '../config/sanity.ts'
import { blocksToHtml } from '../utils/portableText.ts'
import type { IdbEventDetail } from '../types/idb.ts'

const route = useRoute()
const router = useRouter()
const event = ref<IdbEventDetail | null>(null)
const loading = ref(true)
const error = ref(false)
const currentImageIndex = ref(0)

const currentImageUrl = computed<string>(() => {
  const gallery = event.value?.gallery
  if (!gallery?.length) return ''
  const ref = (gallery[currentImageIndex.value].asset as { _ref: string })._ref
  const path = ref.replace(/^image-/, '').replace(/-([a-z]+)$/, '.$1')
  return `${SANITY_IMG}/${path}?w=900&auto=format`
})

function prevImage() {
  const len = event.value?.gallery?.length ?? 0
  currentImageIndex.value = (currentImageIndex.value - 1 + len) % len
}

function nextImage() {
  const len = event.value?.gallery?.length ?? 0
  currentImageIndex.value = (currentImageIndex.value + 1) % len
}

function handleInternalLinks(e: MouseEvent) {
  const link = (e.target as HTMLElement).closest('a.internal-link')
  if (link) {
    e.preventDefault()
    router.push(link.getAttribute('href') ?? '/')
  }
}

onMounted(async () => {
  try {
    event.value = await fetchEventDetailBySlug(route.params.slug as string)
    if (!event.value) error.value = true
  } catch {
    error.value = true
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.event-page {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: var(--color-bg);
}

/* ── Back ─────────────────────────────────────────────────── */
.back-btn {
  background: none;
  border: none;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-navy);
  cursor: pointer;
  padding: 12px 16px;
  display: block;
}

/* ── Status ───────────────────────────────────────────────── */
.status {
  padding: 48px 24px;
  text-align: center;
  font-size: 13px;
  color: var(--color-muted);
}
.error { color: var(--color-red); }

/* ── Timeline section ─────────────────────────────────────── */
.timeline-section {
  padding: 16px 16px 0;
}

.timeline-heading {
  font-size: 16px;
  font-weight: 700;
  color: var(--color-text);
  margin: 0 0 10px;
}

.timeline-filters {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.filter-select {
  font-size: 13px;
  padding: 4px 8px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
}

.timeline-placeholder {
  width: 100%;
  height: 180px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  margin-bottom: 16px;
}

/* ── Divider ──────────────────────────────────────────────── */
.divider {
  border: none;
  border-top: 1px solid var(--color-border);
  margin: 0;
}

/* ── Article ──────────────────────────────────────────────── */
.article {
  padding: 16px 16px 40px;
  max-width: 720px;
}

.event-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text);
  margin: 0 0 8px;
  line-height: 1.3;
}

/* ── Section ──────────────────────────────────────────────── */
.section {
  border-top: 0.5px solid var(--color-border);
  padding: 14px 0;
}

.section-heading {
  font-size: 13px;
  font-weight: 700;
  color: var(--color-muted);
  margin: 0 0 8px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* ── Portable text ────────────────────────────────────────── */
.portable-text :deep(p) {
  margin: 0 0 0.75em;
  font-size: 14px;
  line-height: 1.75;
  color: var(--color-text);
  white-space: pre-line;
}

.portable-text :deep(p:last-child) { margin-bottom: 0; }

.portable-text :deep(pre.pre-table) {
  font-family: 'Courier New', Courier, monospace;
  font-size: 11px;
  tab-size: 4;
  white-space: pre-wrap;
  overflow-x: auto;
  background: color-mix(in srgb, var(--color-border) 50%, var(--color-surface));
  border-radius: 3px;
  padding: 8px 10px;
  line-height: 1.65;
  color: var(--color-text);
  margin: 0 0 0.75em;
}

.portable-text :deep(strong) {
  font-weight: 600;
  color: var(--color-text);
}

.portable-text :deep(u) { text-decoration: underline; }
.portable-text :deep(em) { font-style: italic; }

.portable-text :deep(a.internal-link),
.portable-text :deep(a.external-link) {
  color: var(--color-navy);
  text-decoration: underline;
  cursor: pointer;
}

.portable-text :deep(a.external-link::after) {
  content: ' ↗';
  font-size: 11px;
  opacity: 0.6;
}

/* ── Section links ────────────────────────────────────────── */
.section-link {
  display: block;
  font-size: 13px;
  color: var(--color-navy);
  text-decoration: none;
  padding: 2px 0;
}

.section-link:hover { text-decoration: underline; }

.people-list,
.transport-list,
.links-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* ── Carousel ─────────────────────────────────────────────── */
.carousel {
  display: flex;
  align-items: center;
  gap: 8px;
}

.carousel-img {
  flex: 1;
  width: 100%;
  max-height: 360px;
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

/* ── External links ───────────────────────────────────────── */
.ext-link {
  font-size: 13px;
  color: var(--color-navy);
  text-decoration: none;
  padding: 2px 0;
  word-break: break-all;
}

.ext-link:hover { text-decoration: underline; }

.ext-icon {
  font-size: 11px;
  opacity: 0.6;
}
</style>
