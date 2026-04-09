<template>
  <div class="detail">
    <!-- Hero image -->
    <div class="hero">
      <img
        v-if="heroUrl"
        :src="heroUrl"
        :alt="event.title"
        class="hero-img"
      />
      <div v-else class="hero-placeholder"></div>
      <button class="back-btn" aria-label="Tilbake" @click="emit('back')">&#x2039;</button>
    </div>

    <div class="content">
      <h2 class="title">{{ event.title }}</h2>
      <p v-if="meta" class="meta">{{ meta }}</p>
      <p v-if="event.description" class="description">{{ event.description }}</p>
    </div>

    <!-- Rute section -->
    <div v-if="hasRoute" class="section">
      <div class="section-label">Rute</div>
      <div class="route-pills">
        <span v-if="event.stationFrom" class="pill">{{ event.stationFrom.title }}</span>
        <span v-if="event.stationFrom && (event.locationFrom || event.locationTo)" class="arrow">&#x2192;</span>
        <span v-if="event.locationFrom" class="pill">{{ event.locationFrom.title }}</span>
        <span v-if="event.locationFrom && event.locationTo" class="arrow">&#x2192;</span>
        <span v-if="event.locationTo && !event.locationFrom && event.stationFrom" class="arrow">&#x2192;</span>
        <span v-if="event.locationTo" class="pill">{{ event.locationTo.title }}</span>
      </div>
    </div>

    <!-- Transport section -->
    <div v-if="event.transport && event.transport.length" class="section">
      <div class="section-label">Transport</div>
      <ul class="plain-list">
        <li v-for="(t, i) in event.transport" :key="i" class="plain-item">{{ t.name }}</li>
      </ul>
    </div>

    <!-- Besetning section -->
    <div v-if="event.people && event.people.length" class="section">
      <div class="section-label">Besetning</div>
      <p class="people-line">{{ event.people.map(p => p.name).join(', ') }}</p>
    </div>

    <!-- Bilder section -->
    <PhotoStrip v-if="gallery.length" :images="gallery" @open="() => {}" />

    <!-- Lenker section -->
    <div v-if="event.links && event.links.length" class="section">
      <div class="section-label">Lenker</div>
      <ul class="plain-list">
        <li v-for="link in event.links" :key="link._key" class="plain-item">
          <a :href="link.link" target="_blank" rel="noopener noreferrer" class="link">
            {{ link.title || link.link }}
          </a>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { SANITY_IMG } from '../config/sanity.ts'
import type { IdbEventDetail, IdbGalleryImage } from '../types/idb.ts'
import PhotoStrip from './PhotoStrip.vue'

const props = defineProps<{ event: IdbEventDetail }>()
const emit = defineEmits<{ back: [] }>()

const gallery = computed<IdbGalleryImage[]>(() => props.event.gallery ?? [])

const heroUrl = computed<string | null>(() => {
  if (!gallery.value.length) return null
  const path = gallery.value[0].asset._ref
    .replace(/^image-/, '').replace(/-([a-z]+)$/, '.$1')
  return `${SANITY_IMG}/${path}?w=720&h=130&fit=crop&auto=format`
})

const meta = computed<string | null>(() => {
  const parts: string[] = []
  if (props.event.date) parts.push(props.event.date)
  if (props.event.organization) parts.push(props.event.organization)
  if (props.event.district) parts.push(props.event.district)
  return parts.join(' · ') || null
})

const hasRoute = computed(() =>
  !!(props.event.locationFrom || props.event.locationTo || props.event.stationFrom),
)
</script>

<style scoped>
.detail {
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  scrollbar-width: none;
  flex: 1;
  min-height: 0;
}
.detail::-webkit-scrollbar { display: none; }

.hero {
  position: relative;
  height: 130px;
  flex-shrink: 0;
}
.hero-img, .hero-placeholder {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.hero-placeholder {
  background: var(--color-navy);
}
.back-btn {
  position: absolute;
  top: 50%;
  left: 12px;
  transform: translateY(-50%);
  background: rgba(0,0,0,0.35);
  border: none;
  color: #fff;
  font-size: 22px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.content {
  padding: 12px 14px;
  flex-shrink: 0;
}
.title {
  font-size: 17px;
  font-weight: 700;
  color: var(--color-text);
  line-height: 1.3;
  margin: 0 0 4px;
}
.meta {
  font-size: 12px;
  color: var(--color-muted);
  margin: 0 0 8px;
}
.description {
  font-size: 13px;
  color: var(--color-text);
  line-height: 1.6;
  margin: 0;
  white-space: pre-line;
}

.section {
  flex-shrink: 0;
  border-top: 0.5px solid var(--color-border);
  padding: 10px 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.section-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--color-muted);
}

.route-pills {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.pill {
  font-size: 12px;
  color: var(--color-text);
  background: var(--color-bg);
  border: 0.5px solid var(--color-border-mid);
  border-radius: 4px;
  padding: 2px 7px;
  white-space: nowrap;
}

.arrow {
  font-size: 12px;
  color: var(--color-muted);
}

.plain-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.plain-item {
  font-size: 13px;
  color: var(--color-text);
  line-height: 1.4;
}

.people-line {
  font-size: 13px;
  color: var(--color-text);
  line-height: 1.5;
  margin: 0;
}

.link {
  color: var(--color-navy);
  text-decoration: underline;
  text-decoration-color: var(--color-border-mid);
  font-size: 13px;
  word-break: break-all;
}
.link:hover {
  text-decoration-color: var(--color-navy);
}
</style>
