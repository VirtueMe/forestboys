<template>
  <!-- Hendelser (legacy IDB fallback — only when no Neo4j Incident list rendered) -->
  <section v-if="showLegacyEvents && person.events?.length" class="section">
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
        <span v-if="eventTags(event).length" class="event-tags">
          <span v-for="tag in eventTags(event)" :key="tag" class="event-tag">{{ tag }}</span>
        </span>
      </RouterLink>
    </div>
  </section>

  <section v-if="person.locations?.length" class="section">
    <h3 class="section-heading">Vært stasjonert på</h3>
    <div class="link-list">
      <RouterLink
        v-for="loc in person.locations"
        :key="loc.slug"
        :to="placeRoute(loc.slug)"
        class="section-link"
      >
        {{ loc.title }}
      </RouterLink>
    </div>
  </section>

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

  <section v-if="person.movie" class="section">
    <h3 class="section-heading">Video</h3>
    <video controls class="video-player">
      <source :src="person.movie" type="video/mp4" />
    </video>
  </section>
</template>

<script setup lang="ts">
/**
 * PersonExtraSections — read-only list/asset sections that hang below the
 * Beskrivelse + relation lists on a person page. Steder / Baser / Annen
 * informasjon / Video, plus the legacy Sanity-era Hendelser fallback when
 * the Neo4j Incident list is empty.
 */
import { ref, computed } from 'vue'
import { RouterLink } from 'vue-router'
import type { IdbEvent } from '@/types/idb.ts'
import { usePlaceRoute } from '@/composables/usePlaceRoute.ts'

interface PersonShape {
  events?:    IdbEvent[]
  locations?: { slug: string; title: string }[]
  stations?:  { slug: string; title: string }[]
  movie?:     string | null
}

interface OutlineRef { slug: string; title: string }

const props = defineProps<{
  person:            PersonShape
  outlines:          OutlineRef[]
  /** Hide the legacy IDB events list when Neo4j incidents take precedence. */
  showLegacyEvents:  boolean
}>()

const placeRoute = usePlaceRoute()

const eventSortAsc = ref(true)

const sortedEvents = computed<IdbEvent[]>(() => {
  const evs = props.person.events ?? []
  return [...evs].sort((a, b) => {
    const ad = a.date ?? ''
    const bd = b.date ?? ''
    return eventSortAsc.value ? ad.localeCompare(bd) : bd.localeCompare(ad)
  })
})

function eventTags(event: IdbEvent): string[] {
  return [event.organization, event.district].filter((t): t is string => Boolean(t))
}

const MONTHS = ['januar','februar','mars','april','mai','juni','juli','august','september','oktober','november','desember']
function formatDate(iso?: string): string {
  if (!iso) return '–'
  const [y, m, d] = iso.split('-').map(Number)
  return `${d}. ${MONTHS[m - 1]} ${y}`
}
</script>

<style scoped>
.section-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  margin-bottom: var(--space-sm);
}
.section-header-row .section-heading { margin-bottom: 0; }

.sort-btn {
  background: transparent;
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  font-size: var(--size-label);
  font-weight: 500;
  color: var(--ink);
  padding: var(--space-xs) var(--space-sm);
  cursor: pointer;
  white-space: nowrap;
}
.sort-btn:hover { background: var(--paper-sunken); }

.link-list { display: flex; flex-direction: column; gap: var(--space-xs); }

.section-link {
  display: block;
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink);
  text-decoration: underline;
  text-decoration-color: var(--rule);
  text-underline-offset: 3px;
  padding: var(--space-xs) 0;
}
.section-link:hover { color: var(--faded-red); text-decoration-color: var(--faded-red); }

.event-item {
  display: flex;
  align-items: baseline;
  gap: var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  margin: 0 calc(var(--space-sm) * -1);
  text-decoration: none;
  color: var(--ink);
  border-bottom: 1px solid var(--rule);
  border-radius: var(--radius-md);
  transition: background 120ms ease-out;
}
.event-item:last-child { border-bottom: none; }
.event-item:hover { background: var(--paper-sunken); }
.event-item:hover .event-title { color: var(--faded-red); }

.event-date {
  font-family: var(--font-mono);
  font-size: var(--size-mono);
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  flex-shrink: 0;
}

.event-title {
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink);
  flex: 1;
  min-width: 0;
}

.event-tags {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
  flex-shrink: 0;
}
.event-tag {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--ink-soft);
  background: var(--paper-sunken);
  border-radius: var(--radius-pill);
  padding: var(--space-xs) var(--space-sm);
}

.video-player {
  width: 100%;
  max-width: 720px;
  border-radius: var(--radius-md);
  background: var(--ink);
}
</style>
