<template>
  <details v-if="!hideEditable && previewSections.length" class="section" open>
    <summary class="section-summary">
      <h3 class="section-heading">Beskrivelse</h3>
    </summary>
    <div class="section-body">
      <DescriptionPreview :sections="previewSections" />
    </div>
  </details>

  <details v-if="legacyDescription" class="section" open>
    <summary class="section-summary">
      <h3 class="section-heading">Beskrivelse (arkiv)</h3>
    </summary>
    <div class="section-body">
      <LegacyDescription :text="legacyDescription" />
    </div>
  </details>

  <details v-if="events.length" class="section" open>
    <summary class="section-summary">
      <h3 class="section-heading">Hendelser ({{ events.length }})</h3>
    </summary>
    <div class="section-body">
      <div class="section-tools">
        <button class="sort-btn" @click="eventSortAsc = !eventSortAsc">Dato {{ eventSortAsc ? '↑' : '↓' }}</button>
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
    </div>
  </details>

  <details v-if="crew.length" class="section" open>
    <summary class="section-summary">
      <h3 class="section-heading">Mannskap ({{ crew.length }})</h3>
    </summary>
    <div class="section-body">
      <div class="relation-list">
        <div v-for="p in crew" :key="`${p.slug}-${p.role ?? ''}`" class="relation-row">
          <RouterLink :to="`/person/${p.slug}`" class="person-name-link">{{ p.name }}</RouterLink>
          <span v-if="p.role" class="relation-role">{{ p.role }}</span>
        </div>
      </div>
    </div>
  </details>

  <details v-if="galleryImages.length" class="section" open>
    <summary class="section-summary">
      <h3 class="section-heading">Galleri ({{ galleryImages.length }})</h3>
    </summary>
    <div class="section-body">
      <ImageSlider :images="galleryImages" />
    </div>
  </details>

  <details class="section" open>
    <summary class="section-summary">
      <h3 class="section-heading">Lenker<span v-if="totalLinkCount"> ({{ totalLinkCount }})</span></h3>
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
        <a
          v-for="(l, i) in legacyLinks"
          :key="`legacy-${i}`"
          :href="l.link"
          target="_blank"
          rel="noopener noreferrer"
          class="ref-item"
        >
          <span class="ref-title">{{ l.title || l.link }}</span>
          <span class="ref-meta"><span class="ref-archive">arkiv</span></span>
        </a>
      </div>
      <p v-else class="section-empty">Ingen lenker registrert ennå.</p>
    </div>
  </details>
</template>

<script setup lang="ts">
/**
 * TransportViewPane — read-only sections of a Transport page.
 *
 * Three legacy data shapes from the Sanity import remain on the node:
 * `description` (free text), `links` (JSON string). They render as
 * dedicated "arkiv" UI until migrated to HAS_CONTENT and REFERENCED_IN.
 *
 * Crew (CREW_OF) is read-only here; the editor for crew lives on the
 * Person side today (the role chips are already populated from the
 * controlled vocab in person migrations).
 */
import { ref, computed } from 'vue'
import { RouterLink } from 'vue-router'
import ImageSlider, { type SlideImage } from '@/components/ImageSlider.vue'
import DescriptionPreview from '@/components/DescriptionPreview.vue'
import LegacyDescription from '@/components/LegacyDescription.vue'
import type { Section } from '@/components/SectionsEditor.vue'
import type { TransportCrewMember, TransportEvent, TransportExternalRef } from '@/composables/useTransportData.ts'

const props = withDefaults(defineProps<{
  previewSections:   Section[]
  legacyDescription: string | null
  legacyLinksJson:   string | null
  crew:              TransportCrewMember[]
  events:            TransportEvent[]
  externalRefs:      TransportExternalRef[]
  galleryImages:     SlideImage[]
  hideEditable?:     boolean
}>(), {
  hideEditable: false,
})

interface LegacyLink { title: string; link: string }
const legacyLinks = computed<LegacyLink[]>(() => {
  if (!props.legacyLinksJson) return []
  try {
    const parsed = JSON.parse(props.legacyLinksJson) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((x): x is { title?: unknown; link?: unknown } => typeof x === 'object' && x !== null)
      .map(x => ({
        title: typeof x.title === 'string' ? x.title : '',
        link:  typeof x.link  === 'string' ? x.link  : '',
      }))
      .filter(l => l.link)
  } catch { return [] }
})

const totalLinkCount = computed(() => props.externalRefs.length + legacyLinks.value.length)

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
.event-title { font-size: 13px; color: var(--focus); flex: 1; min-width: 0; }

.relation-list { display: flex; flex-direction: column; gap: 2px; }
.relation-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}
.person-name-link {
  font-size: 13px;
  color: var(--focus);
  text-decoration: none;
}
.person-name-link:hover { text-decoration: underline; }
.relation-role {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
  padding: 1px 6px;
  border: 1px solid var(--rule);
  border-radius: 3px;
}

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
.ref-archive {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  background: var(--paper-sunken);
  color: var(--muted);
  border: 1px solid var(--rule);
}
.ref-domain { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
</style>
