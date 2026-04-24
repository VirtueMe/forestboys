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
  if ('color' in props.item && props.item.color === 'red') return 'var(--faded-red)'
  if ('color' in props.item && props.item.color === 'green') return 'var(--moss)'
  return 'var(--focus)'
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
  left: var(--space-md);
  transform: translateY(-50%);
  background: rgba(26, 26, 26, 0.45);
  border: none;
  color: var(--paper);
  font-size: var(--size-h2);
  width: 36px;
  height: 36px;
  border-radius: var(--radius-pill);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.content {
  padding: var(--space-md);
  flex-shrink: 0;
}
.title {
  font-family: var(--font-serif);
  font-size: var(--size-h2);
  font-weight: 600;
  color: var(--ink);
  line-height: var(--leading-snug);
  margin: 0 0 var(--space-xs);
}
.meta {
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--muted);
  margin: 0 0 var(--space-sm);
}
.description {
  font-family: var(--font-serif);
  font-size: var(--size-body);
  color: var(--ink);
  line-height: var(--leading-prose);
  margin: 0;
  white-space: pre-line;
}

/* People section */
.people-section {
  flex-shrink: 0;
  border-top: 1px solid var(--rule);
  padding: var(--space-md);
}

.section-label {
  display: block;
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: var(--tracking-caps);
  color: var(--muted);
  margin-bottom: var(--space-sm);
}

.people-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}

.person-chip {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--ink-soft);
  background: var(--paper-sunken);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-pill);
  text-decoration: none;
}
.person-chip:hover { background: var(--ink); color: var(--paper); }

/* Events section */
.events-section {
  flex-shrink: 0;
  border-top: 1px solid var(--rule);
  padding: var(--space-md);
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.events-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-xs) var(--space-xs);
}

.events-label {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: var(--tracking-caps);
  color: var(--muted);
}

.events-pager {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.epager-btn {
  background: none;
  border: none;
  padding: var(--space-xs) var(--space-sm);
  font-family: var(--font-sans);
  font-size: var(--size-label);
  font-weight: 500;
  color: var(--ink-soft);
  cursor: pointer;
  border-radius: var(--radius-md);
}
.epager-btn:hover:not(:disabled) { color: var(--faded-red); }
.epager-btn:disabled {
  color: var(--rule);
  cursor: default;
}

.epager-counter {
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--muted);
}

.events-empty {
  font-family: var(--font-sans);
  font-size: var(--size-label);
  font-style: italic;
  color: var(--muted);
  padding: var(--space-xs);
  margin: 0;
}
</style>
