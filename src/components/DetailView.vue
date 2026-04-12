<template>
  <div class="detail">
    <!-- Hero image -->
    <div class="hero">
      <img
        v-if="heroUrl"
        :src="heroUrl"
        :alt="displayTitle"
        class="hero-img"
      />
      <div v-else class="hero-placeholder" :style="{ background: accentColor }"></div>
      <button class="back-btn" aria-label="Tilbake" @click="emit('back')">‹</button>
    </div>

    <div class="content">
      <h2 class="title">{{ displayTitle }}</h2>
      <p v-if="meta" class="meta">{{ meta }}</p>
      <p v-if="description" class="description">{{ description }}</p>
    </div>

    <PhotoStrip v-if="gallery.length" :images="gallery" @open="openPhoto" />

    <!-- People section -->
    <div v-if="people.length" class="people-section">
      <span class="section-label">Tilknyttede personer</span>
      <div class="people-list">
        <RouterLink
          v-for="p in people"
          :key="p._id"
          :to="`/person/${p.slug}`"
          class="person-chip"
        >
          {{ p.name }}
        </RouterLink>
      </div>
    </div>

    <!-- Events section -->
    <div class="events-section">
      <div class="events-header">
        <span class="events-label">Hendelser</span>
        <div v-if="eventPages > 1" class="events-pager">
          <button class="epager-btn" :disabled="eventPage === 0" @click="eventPage--">←</button>
          <span class="epager-counter">{{ eventPage + 1 }} / {{ eventPages }}</span>
          <button class="epager-btn" :disabled="eventPage === eventPages - 1" @click="eventPage++">→</button>
        </div>
      </div>

      <template v-if="events.length">
        <ItemCard
          v-for="ev in eventsOnPage(eventPage)"
          :key="ev._id"
          :title="ev.title"
          :subtitle="ev.date ?? ''"
          :tags="[ev.organization, ev.district].filter(Boolean) as string[]"
          @select="emit('select-event', ev)"
        />
      </template>
      <p v-else class="events-empty">Ingen hendelser registrert for dette stedet.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { RouterLink } from 'vue-router'
import { SANITY_IMG } from '../config/sanity.ts'
import type { IdbLocation, IdbStation, IdbPerson, IdbEvent, IdbGalleryImage } from '../types/idb.ts'
import PhotoStrip from './PhotoStrip.vue'
import ItemCard from './ItemCard.vue'

type AnyItem = IdbLocation | IdbStation | IdbPerson

const props = defineProps<{ item: AnyItem }>()
const emit = defineEmits<{
  back: []
  'select-event': [event: IdbEvent]
}>()

// Diagnostic — check browser console when a detail opens
console.log('[detail] item:', 'name' in props.item ? props.item.name : props.item.title)
console.log('[detail] description raw:', props.item.description)
console.log('[detail] events count:', props.item.events?.length ?? 0)

const PER_PAGE = 3
const eventPage = ref(0)

const displayTitle = computed<string>(() =>
  'name' in props.item ? props.item.name : props.item.title,
)

const gallery = computed<IdbGalleryImage[]>(() => props.item.gallery ?? [])

const heroUrl = computed<string | null>(() => {
  if (!gallery.value.length) return null
  const path = gallery.value[0].asset._ref
    .replace(/^image-/, '').replace(/-([a-z]+)$/, '.$1')
  return `${SANITY_IMG}/${path}?w=720&h=130&fit=crop&auto=format`
})

const accentColor = computed(() => {
  if ('color' in props.item && props.item.color === 'red') return 'var(--color-red)'
  if ('color' in props.item && props.item.color === 'green') return 'var(--color-green)'
  return 'var(--color-navy)'
})

const meta = computed(() => {
  const item = props.item
  const parts: string[] = []
  if ('districts' in item && item.districts?.length) parts.push(item.districts[0])
  if ('organizations' in item && item.organizations?.length) parts.push(item.organizations[0])
  if ('birthYear' in item && item.birthYear) parts.push(String(item.birthYear))
  if ('type' in item && item.type) parts.push(item.type)
  return parts.join(' · ') || null
})

const description = computed<string | null>(() => props.item.description ?? null)

const people = computed<{ _id: string; name: string; slug: string }[]>(
  () => ('people' in props.item ? props.item.people ?? [] : []),
)

const events = computed<IdbEvent[]>(() => props.item.events ?? [])
const eventPages = computed(() => Math.ceil(events.value.length / PER_PAGE) || 1)

function eventsOnPage(page: number): IdbEvent[] {
  return events.value.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE)
}

function openPhoto(_photoIndex: number) {
  // lightbox — future implementation
}
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

/* People section */
.people-section {
  flex-shrink: 0;
  border-top: 0.5px solid var(--color-border);
  padding: 10px 10px 8px;
}

.section-label {
  display: block;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--color-muted);
  margin-bottom: 8px;
}

.people-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.person-chip {
  font-size: 12px;
  color: var(--color-navy);
  background: var(--color-border);
  padding: 4px 10px;
  border-radius: 12px;
  text-decoration: none;
}
.person-chip:hover { background: var(--color-border-mid); }

/* Events section */
.events-section {
  flex-shrink: 0;
  border-top: 0.5px solid var(--color-border);
  padding: 10px 10px 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.events-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2px 4px;
}

.events-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--color-muted);
}

.events-pager {
  display: flex;
  align-items: center;
  gap: 4px;
}

.epager-btn {
  background: none;
  border: none;
  padding: 2px 5px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-muted);
  cursor: pointer;
  border-radius: 3px;
}
.epager-btn:disabled {
  color: var(--color-handle);
  cursor: default;
}

.epager-counter {
  font-size: 11px;
  color: var(--color-muted);
}

.events-empty {
  font-size: 12px;
  color: var(--color-muted);
  padding: 4px 2px 8px;
  margin: 0;
}
</style>
