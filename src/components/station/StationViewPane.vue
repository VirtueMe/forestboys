<template>
  <!-- Single root so the page's v-show applies. -->
  <div class="view-pane">
    <details v-if="!hideEditable && lat != null && lng != null" class="section" open>
      <summary class="section-summary">
        <h3 class="section-heading">Kart</h3>
      </summary>
      <div class="section-body">
        <LocationMap :lat="lat" :lng="lng" readonly :marker-to="slug ? `/map/${slug}` : undefined" />
      </div>
    </details>

    <details v-if="!hideEditable && sortedNames.length" class="section" open>
      <summary class="section-summary">
        <h3 class="section-heading">Navnehistorikk ({{ sortedNames.length }})</h3>
      </summary>
      <div class="section-body">
        <ul class="name-history">
          <li v-for="n in sortedNames" :key="n.id" class="name-item">
            <span class="name-value">{{ n.value }}</span>
            <span class="name-kind">{{ NAME_TYPE_LABEL[n.type] }}</span>
            <span v-if="formatNamePeriod(n)" class="name-period">{{ formatNamePeriod(n) }}</span>
            <SourceRef v-if="n.sourceRefs.length" :refs="n.sourceRefs" inline />
          </li>
        </ul>
      </div>
    </details>

    <details v-if="!hideEditable && previewSections.length" class="section" open>
      <summary class="section-summary">
        <h3 class="section-heading">Beskrivelse</h3>
      </summary>
      <div class="section-body">
        <DescriptionPreview :sections="previewSections" />
      </div>
    </details>

    <!-- Legacy free-text description from Sanity migration. Read-only
         until migrated to HAS_CONTENT. -->
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
            :key="`${event.slug}-${event.direction}`"
            :to="`/events/${event.slug}`"
            class="event-item"
          >
            <span class="event-date">{{ formatDate(event.date) }}</span>
            <span class="event-direction" :class="`event-direction--${event.direction}`">
              {{ event.direction === 'departed' ? 'Avgang' : 'Ankomst' }}
            </span>
            <span class="event-title">{{ event.title }}</span>
          </RouterLink>
        </div>
      </div>
    </details>

    <details v-if="!hideEditable && people.length" class="section" open>
      <summary class="section-summary">
        <h3 class="section-heading">Deltakere ({{ people.length }})</h3>
      </summary>
      <div class="section-body">
        <!-- One role in use: a flat list with the role on each row, as before. -->
        <RelationListView
          v-if="peopleGroups.length <= 1"
          :entries="people"
          :strategy="StationStaysStrategy"
          label="Deltakere"
          show-role
          headless
          @open="e => activeStay = e"
        />
        <!-- Several roles: a group per role, so an instructor is not lost among 39 students. -->
        <div v-for="g in peopleGroups" v-else :key="g.role ?? 'none'" class="role-group">
          <h4 class="role-group-heading">
            <RoleLabel v-if="g.role" :role-key="g.role" />
            <template v-else>Uten rolle</template>
            <span class="role-group-count">({{ g.entries.length }})</span>
          </h4>
          <RelationListView
            :entries="g.entries"
            :strategy="StationStaysStrategy"
            label="Deltakere"
            headless
            @open="e => activeStay = e"
          />
        </div>
      </div>
    </details>
    <RelationInfoPopup :entry="activeStay" show-role @close="activeStay = null" />

    <details v-if="galleryImages.length" class="section" open>
      <summary class="section-summary">
        <h3 class="section-heading">Galleri ({{ galleryImages.length }})</h3>
      </summary>
      <div class="section-body">
        <ImageSlider :images="galleryImages" />
      </div>
    </details>

    <details v-if="!hideEditable && sourceRefs.length" class="section" open>
      <summary class="section-summary">
        <h3 class="section-heading">Kilder ({{ sourceRefs.length }})</h3>
      </summary>
      <div class="section-body">
        <SourceRef :refs="sourceRefs" inline />
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
  </div>
</template>

<script setup lang="ts">
/**
 * StationViewPane — read-only sections for a Station page.
 *
 * Three legacy data shapes still live on the Neo4j Station node from
 * the Sanity import: `description` (free text), `links` (JSON string).
 * They render here in dedicated sections (Beskrivelse arkiv, mixed
 * into Lenker as "arkiv" chips) until a future pass migrates them to
 * HAS_CONTENT and REFERENCED_IN respectively.
 */
import { ref, computed } from 'vue'
import { RouterLink } from 'vue-router'
import ImageSlider, { type SlideImage } from '@/components/ImageSlider.vue'
import DescriptionPreview from '@/components/DescriptionPreview.vue'
import LegacyDescription from '@/components/LegacyDescription.vue'
import type { Section } from '@/components/SectionsEditor.vue'
import RelationListView from '@/components/relation/RelationListView.vue'
import RelationInfoPopup from '@/components/relation/RelationInfoPopup.vue'
import RoleLabel from '@/components/role/RoleLabel.vue'
import { useRoles } from '@/composables/useRoles.ts'
import { groupByRole } from '@/utils/roleGroups.ts'
import { StationStaysStrategy } from '@/components/relation/stayStrategies.ts'
import type { RelationEntry } from '@/components/relation/RelationStrategy.ts'
import SourceRef from '@/components/SourceRef.vue'
import LocationMap from '@/components/location/LocationMap.vue'
import type { StationEvent, StationExternalRef, StationName } from '@/composables/useStationData.ts'
import { NAME_TYPE_LABEL, formatNamePeriod, sortNames } from '@/utils/stationNames.ts'

const props = withDefaults(defineProps<{
  /** The Station's slug and coordinates, for the map. */
  slug?:             string
  lat?:              number | null
  lng?:              number | null
  /** The Station's other names (HAS_NAME). */
  names:             StationName[]
  /** What backs the station's facts — one list for the whole station. */
  sourceRefs:        string[]
  previewSections:   Section[]
  legacyDescription: string | null
  legacyLinksJson:   string | null
  /** STATIONED_AT stays at this Station. */
  people:            RelationEntry[]
  events:            StationEvent[]
  externalRefs:      StationExternalRef[]
  galleryImages:     SlideImage[]
  hideEditable?:     boolean
}>(), {
  hideEditable: false,
})

const activeStay = ref<RelationEntry | null>(null)

const sortedNames = computed(() => sortNames(props.names))

const { roles } = useRoles()
const peopleGroups = computed(() =>
  groupByRole(props.people, key => roles.value.get(key)?.name ?? key),
)

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
  display: grid;
  grid-template-columns: 9.5rem 5rem minmax(0, 1fr);
  align-items: baseline;
  column-gap: 10px;
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
  justify-self: start;
}
.event-direction--departed { background: var(--paper); color: var(--focus); border: 1px solid var(--rule); }
.event-direction--arrived  { background: var(--paper); color: var(--moss);  border: 1px solid var(--rule); }
.event-title { font-size: 13px; color: var(--focus); min-width: 0; }
@media (max-width: 520px) {
  .event-item { grid-template-columns: 1fr auto; row-gap: 2px; }
  .event-title { grid-column: 1 / -1; }
}

.role-group + .role-group { margin-top: var(--space-md); }
.role-group-heading {
  margin: 0 0 var(--space-xs);
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--muted);
}
.role-group-count { margin-left: 0.4em; font-weight: 400; }
.name-history { list-style: none; margin: 0; padding: 0; }
.name-item {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 10px;
  padding: 6px 0;
  border-bottom: 1px solid var(--rule);
}
.name-item:last-child { border-bottom: none; }
.name-value { font-size: 14px; font-weight: 600; color: var(--ink); }
.name-kind {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--muted);
}
.name-period { font-size: 12px; color: var(--ink-soft); font-variant-numeric: tabular-nums; }

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
