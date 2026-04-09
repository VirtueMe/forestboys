<template>
  <div class="event-panel">
    <div class="panel-header">
      <p v-if="event.date" class="event-date">{{ formatDate(event.date) }}</p>
      <h2 class="event-title">{{ event.title }}</h2>
      <p v-if="meta" class="event-meta">{{ meta }}</p>
    </div>

    <!-- Beskrivelse -->
    <section v-if="event.description?.length" class="section">
      <h3 class="section-heading">Beskrivelse</h3>
      <!-- eslint-disable vue/no-v-html -->
      <div
        class="portable-text"
        @click.capture="handleInternalLinks"
        v-html="blocksToHtml(event.description)"
      ></div>
      <!-- eslint-enable vue/no-v-html -->
    </section>

    <!-- Fra Sted -->
    <section v-if="event.locationFrom" class="section">
      <h3 class="section-heading">Fra Sted</h3>
      <RouterLink :to="`/map/${event.locationFrom.slug}`" class="section-link">
        {{ event.locationFrom.title }}
      </RouterLink>
    </section>

    <!-- Til Sted -->
    <section v-if="event.locationTo" class="section">
      <h3 class="section-heading">Til Sted</h3>
      <RouterLink :to="`/map/${event.locationTo.slug}`" class="section-link">
        {{ event.locationTo.title }}
      </RouterLink>
    </section>

    <!-- Fra Base -->
    <section v-if="event.stationFrom || event.stationTo" class="section">
      <h3 class="section-heading">Fra Base</h3>
      <RouterLink v-if="event.stationFrom" :to="`/station/${event.stationFrom.slug}`" class="section-link">
        {{ event.stationFrom.title }}
      </RouterLink>
      <RouterLink v-if="event.stationTo" :to="`/station/${event.stationTo.slug}`" class="section-link">
        {{ event.stationTo.title }}
      </RouterLink>
    </section>

    <!-- Deltakere -->
    <section v-if="event.people?.length" class="section">
      <h3 class="section-heading">Deltakere</h3>
      <div class="link-list">
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
      <h3 class="section-heading">Transportmiddel</h3>
      <div class="link-list">
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
      <h3 class="section-heading">Galleri</h3>
      <div class="carousel">
        <button
          v-if="event.gallery.length > 1"
          class="carousel-btn"
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
          class="carousel-btn"
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
      <h3 class="section-heading">Nyttige lenker</h3>
      <div class="link-list">
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
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { SANITY_IMG } from '../config/sanity.ts'
import { blocksToHtml } from '../utils/portableText.ts'
import type { IdbEventDetail } from '../types/idb.ts'

const props = defineProps<{ event: IdbEventDetail }>()
const router = useRouter()
const currentImageIndex = ref(0)

watch(() => props.event.slug, () => { currentImageIndex.value = 0 })

const currentImageUrl = computed<string>(() => {
  const gallery = props.event.gallery
  if (!gallery?.length) return ''
  const assetRef = (gallery[currentImageIndex.value].asset as { _ref: string })._ref
  const path = assetRef.replace(/^image-/, '').replace(/-([a-z]+)$/, '.$1')
  return `${SANITY_IMG}/${path}?w=900&auto=format`
})

const meta = computed(() => {
  const parts: string[] = []
  if (props.event.organization) parts.push(props.event.organization)
  if (props.event.district) parts.push(props.event.district)
  return parts.join(' · ') || null
})

const MONTHS = ['januar','februar','mars','april','mai','juni','juli','august','september','oktober','november','desember']

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d}. ${MONTHS[m - 1]} ${y}`
}

function prevImage() {
  const len = props.event.gallery?.length ?? 0
  currentImageIndex.value = (currentImageIndex.value - 1 + len) % len
}

function nextImage() {
  const len = props.event.gallery?.length ?? 0
  currentImageIndex.value = (currentImageIndex.value + 1) % len
}

function handleInternalLinks(e: MouseEvent) {
  const link = (e.target as HTMLElement).closest('a.internal-link')
  if (link) {
    e.preventDefault()
    void router.push(link.getAttribute('href') ?? '/')
  }
}
</script>

<style scoped>
.event-panel {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
}

.panel-header {
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--color-border);
}

.event-date {
  font-size: 12px;
  color: var(--color-muted);
  margin: 0 0 4px;
}

.event-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--color-text);
  margin: 0 0 4px;
  line-height: 1.3;
}

.event-meta {
  font-size: 12px;
  color: var(--color-muted);
  margin: 0;
}

/* ── Section ──────────────────────────────────────────────── */
.section {
  border-top: 0.5px solid var(--color-border);
  padding: 12px 20px;
}

.section-heading {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--color-muted);
  margin: 0 0 8px;
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
.portable-text :deep(strong) { font-weight: 600; color: var(--color-text); }
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

/* ── Links ────────────────────────────────────────────────── */
.link-list { display: flex; flex-direction: column; gap: 4px; }

.section-link {
  display: block;
  font-size: 13px;
  color: var(--color-navy);
  text-decoration: none;
  padding: 2px 0;
}
.section-link:hover { text-decoration: underline; }

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

/* ── Carousel ─────────────────────────────────────────────── */
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
</style>
