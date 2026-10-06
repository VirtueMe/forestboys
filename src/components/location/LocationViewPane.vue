<template>
  <!-- Single root so the page's v-show applies. -->
  <div class="view-pane">
    <details v-if="!hideEditable && lat != null && lng != null" class="section" open>
      <summary class="section-summary">
        <h2 class="section-heading">Kart</h2>
      </summary>
      <div class="section-body">
        <LocationMap :lat="lat" :lng="lng" readonly :marker-to="slug ? `/map/${slug}` : undefined" />
      </div>
    </details>

    <details v-if="!hideEditable && previewSections.length" class="section" open>
      <summary class="section-summary">
        <h2 class="section-heading">Beskrivelse</h2>
      </summary>
      <div class="section-body">
        <DescriptionPreview :sections="previewSections" />
      </div>
    </details>
  
    <details v-if="events.length" class="section" open>
      <summary class="section-summary">
        <h2 class="section-heading">Hendelser ({{ events.length }})</h2>
      </summary>
      <div class="section-body">
        <div class="section-tools">
          <button class="sort-btn" @click="eventSortAsc = !eventSortAsc">Dato {{ eventSortAsc ? '↑' : '↓' }}</button>
        </div>
        <div class="link-list">
          <RouterLink
            v-for="event in sortedEvents"
            :key="`${event.slug}-${event.role}`"
            :to="`/events/${event.slug}`"
            class="event-item"
          >
            <span class="event-date">{{ formatDate(event.date) }}</span>
            <span class="event-direction" :class="`event-direction--${event.role}`">
              {{ ROLE_LABEL[event.role] }}
            </span>
            <span class="event-title">{{ event.title }}</span>
          </RouterLink>
        </div>
      </div>
    </details>
  
    <details v-if="!hideEditable && people.length" class="section" open>
      <summary class="section-summary">
        <h2 class="section-heading">Personer ({{ people.length }})</h2>
      </summary>
      <div class="section-body">
        <RelationListView
          :entries="people"
          :strategy="LocationStaysStrategy"
          label="Personer"
          show-role
          headless
          @open="e => activeStay = e"
        />
      </div>
    </details>
    <RelationInfoPopup :entry="activeStay" show-role @close="activeStay = null" />

    <details v-if="galleryImages.length" class="section" open>
      <summary class="section-summary">
        <h2 class="section-heading">Galleri ({{ galleryImages.length }})</h2>
      </summary>
      <div class="section-body">
        <ImageSlider :images="galleryImages" />
      </div>
    </details>
  
    <details class="section" open>
      <summary class="section-summary">
        <h2 class="section-heading">Lenker<span v-if="totalLinkCount"> ({{ totalLinkCount }})</span></h2>
      </summary>
      <div class="section-body">
        <div v-if="totalLinkCount" class="link-list">
          <a
            v-for="r in externalRefs"
            :key="r.id"
            :href="r.url"
            target="_blank"
            rel="noopener noreferrer"
            class="ref-item"
          >
            <span class="ref-title">{{ r.title ?? r.url }}</span>
            <span class="ref-meta">
              <span v-if="r.nbBacked" class="ref-nb" title="Nasjonalbiblioteket">NB</span>
              <span v-if="r.domain" class="ref-domain">{{ r.domain }}</span>
            </span>
          </a>
        </div>
        <p v-else class="section-empty">Ingen lenker registrert ennå.</p>
      </div>
    </details>
  </div>
</template>

<script setup lang="ts">
/**
 * LocationViewPane — read-only sections for a Location page: Kart
 * (mini map; marker links to /map/<slug>), Beskrivelse, Hendelser (events AT / FROM / TO this place), Galleri,
 * Lenker. Mirror of StationViewPane without the legacy Sanity fields
 * (Locations have none on the Neo4j node).
 */
import { ref, computed } from 'vue'
import { RouterLink } from 'vue-router'
import ImageSlider, { type SlideImage } from '@/components/ImageSlider.vue'
import DescriptionPreview from '@/components/DescriptionPreview.vue'
import type { Section } from '@/components/SectionsEditor.vue'
import LocationMap from './LocationMap.vue'
import RelationListView from '@/components/relation/RelationListView.vue'
import RelationInfoPopup from '@/components/relation/RelationInfoPopup.vue'
import { LocationStaysStrategy } from '@/components/relation/stayStrategies.ts'
import type { RelationEntry } from '@/components/relation/RelationStrategy.ts'
import type { LocationEvent, LocationExternalRef } from '@/composables/useLocationData.ts'

const props = withDefaults(defineProps<{
  lat:             number | null
  lng:             number | null
  /** Marker links to /map/<slug>; absent in create mode. */
  slug?:           string
  previewSections: Section[]
  events:          LocationEvent[]
  externalRefs:    LocationExternalRef[]
  galleryImages:   SlideImage[]
  /** STATIONED_AT stays at this Location. */
  people:          RelationEntry[]
  hideEditable?:   boolean
}>(), {
  hideEditable: false,
})

const activeStay = ref<RelationEntry | null>(null)

const ROLE_LABEL: Record<LocationEvent['role'], string> = { at: 'Sted', from: 'Fra', to: 'Til' }

const totalLinkCount = computed(() => props.externalRefs.length)

const eventSortAsc = ref(true)
const sortedEvents = computed(() => {
  const evts = [...props.events]
  return eventSortAsc.value
    ? evts.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
    : evts.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
})

const MONTHS = ['januar','februar','mars','april','mai','juni','juli','august','september','oktober','november','desember']
function formatDate(iso?: string | null): string {
  if (!iso) return '–'
  const [y, m, d] = iso.split('-').map(Number)
  return `${d}. ${MONTHS[m - 1]} ${y}`
}
</script>

<style scoped>
.section {
  border-bottom: 1px solid var(--rule);
  background: var(--paper-raised);
}
.section + .section { border-top: none; }
.section:last-of-type { margin-bottom: 48px; }

.section-summary {
  cursor: pointer;
  list-style: none;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.section-summary::-webkit-details-marker { display: none; }
.section-summary::after {
  content: '▾';
  font-size: 11px;
  color: var(--muted);
  transition: transform 0.15s ease;
  flex-shrink: 0;
}
.section:not([open]) > .section-summary::after { transform: rotate(-90deg); }
.section-summary:hover { background: var(--paper); }

.section-body { padding: 0 16px 12px; }

.section-empty {
  margin: 0;
  padding: 4px 0;
  font-size: 12px;
  color: var(--muted);
  font-style: italic;
}
.section-tools { display: flex; justify-content: flex-end; margin-bottom: 8px; }
.section-heading {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--muted);
  margin: 0;
}
.sort-btn {
  background: none;
  border: 1px solid var(--rule);
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  padding: 6px 10px;
  cursor: pointer;
  white-space: nowrap;
  touch-action: manipulation;
}
.sort-btn:hover { border-color: var(--focus); color: var(--focus); }

.link-list { display: flex; flex-direction: column; gap: 2px; }

.section-link {
  display: block;
  padding: 6px 8px;
  margin: 0 -8px;
  font-size: 13px;
  color: var(--focus);
  text-decoration: none;
  border-radius: 4px;
}
.section-link:hover { background: var(--paper); text-decoration: underline; }

.event-item {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 6px 8px;
  margin: 0 -8px;
  text-decoration: none;
  color: var(--ink);
  border-bottom: 1px solid var(--rule);
  border-radius: 4px;
  transition: background 0.1s;
}
.event-item:last-child { border-bottom: none; }
.event-item:hover { background: var(--paper); }
.event-item:hover .event-title { text-decoration: underline; }
.event-date {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  flex-shrink: 0;
}
.event-direction {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 1px 6px;
  border-radius: 3px;
  flex-shrink: 0;
}
.event-direction--from { background: var(--paper); color: var(--focus); border: 1px solid var(--rule); }
.event-direction--to   { background: var(--paper); color: var(--moss);  border: 1px solid var(--rule); }
.event-direction--at   { background: var(--paper); color: var(--ink-soft); border: 1px solid var(--rule); }
.event-title { font-size: 13px; color: var(--focus); flex: 1; min-width: 0; }

.ref-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  margin: 0 -8px;
  text-decoration: none;
  color: var(--ink);
  border-radius: 4px;
  transition: background 0.1s;
}
.ref-item:hover { background: var(--paper); }
.ref-item:hover .ref-title { text-decoration: underline; }
.ref-title {
  font-size: 13px;
  color: var(--focus);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ref-meta { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.ref-nb {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  background: var(--color-orange, #e38924);
  color: #fff;
}
.ref-domain { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
</style>
