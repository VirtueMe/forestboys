<template>
  <!-- Single root so the page's v-show applies. -->
  <div class="view-pane">
    <details v-if="!hideEditable && previewSections.length" class="section" open>
      <summary class="section-summary">
        <h2 class="section-heading">Beskrivelse</h2>
      </summary>
      <div class="section-body">
        <DescriptionPreview :sections="previewSections" />
      </div>
    </details>

    <!-- Legacy ABOUT descriptions (sanity-outline-migration). Read-only
         until a future migration converts them to HAS_CONTENT. -->
    <details v-if="legacyDescriptions.length" class="section" open>
      <summary class="section-summary">
        <h2 class="section-heading">Beskrivelse (arkiv)<span v-if="legacyDescriptions.length > 1"> ({{ legacyDescriptions.length }})</span></h2>
      </summary>
      <div class="section-body">
        <article
          v-for="(d, i) in legacyHtml"
          :key="`${d.recordedDate ?? 'd'}-${i}`"
          class="description-entry"
        >
          <!-- eslint-disable vue/no-v-html -->
          <div class="portable-text" v-html="d.html"></div>
          <!-- eslint-enable vue/no-v-html -->
          <footer
            v-if="showDescriptionAttribution(d)"
            class="description-attribution"
          >
            <span v-if="d.author" class="description-author">{{ d.author }}</span>
            <span v-if="d.recordedDate" class="description-date">{{ d.recordedDate }}</span>
            <SourceRef v-if="d.sourceRefs?.length" :refs="d.sourceRefs" />
          </footer>
        </article>
      </div>
    </details>

    <details v-if="subUnits.length" class="section" open>
      <summary class="section-summary"><h2 class="section-heading">Underavdelinger ({{ subUnits.length }})</h2></summary>
      <div class="section-body">
        <div class="link-list">
          <RouterLink
            v-for="sub in subUnits"
            :key="sub.slug"
            :to="`/district/${sub.slug}`"
            class="section-link"
          >
            {{ sub.name }}
          </RouterLink>
        </div>
      </div>
    </details>

    <details v-if="courses.length" class="section" open>
      <summary class="section-summary"><h2 class="section-heading">Kurs ({{ courses.length }})</h2></summary>
      <div class="section-body">
        <div class="course-table-wrap">
          <table class="course-table">
            <thead>
              <tr>
                <th>Kurs</th>
                <th>Oppstart</th>
                <th class="num">Elever</th>
                <th class="num">Mangler</th>
                <th>Gruppe</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in courses" :key="c.slug">
                <td><RouterLink :to="`/district/${c.slug}`" class="course-link">{{ c.letter }}</RouterLink></td>
                <td class="course-date">{{ c.startDate ?? '—' }}</td>
                <td class="num">{{ c.studentCount }}</td>
                <td class="num">{{ c.missingCount > 0 ? c.missingCount : '—' }}</td>
                <td class="course-group">{{ c.targetGroup ?? '—' }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr class="course-total">
                <td>Sum</td>
                <td></td>
                <td class="num">{{ courseTotals.students }}</td>
                <td class="num">{{ courseTotals.missing > 0 ? courseTotals.missing : '—' }}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </details>

    <details v-if="events.length" class="section" open>
      <summary class="section-summary"><h2 class="section-heading">Hendelser ({{ events.length }})</h2></summary>
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

    <details v-if="galleryImages.length" class="section" open>
      <summary class="section-summary"><h2 class="section-heading">Galleri ({{ galleryImages.length }})</h2></summary>
      <div class="section-body">
        <ImageSlider :images="galleryImages" />
      </div>
    </details>

    <details v-if="!hideEditable && members.length" class="section" open>
      <summary class="section-summary"><h2 class="section-heading">Medlemmer ({{ members.length }})</h2></summary>
      <div class="section-body">
        <div class="relation-list">
          <div v-for="p in members" :key="p.slug" class="relation-row member-row">
            <RouterLink :to="`/person/${p.slug}`" class="person-name-link">{{ p.name }}</RouterLink>
            <span v-if="p.status === 'KIA'" class="status-marker status-marker--kia" title="Falt">✝</span>
            <span v-else-if="p.status === 'ambiguous'" class="status-marker status-marker--ambig" title="Uavklart skjebne">∞</span>
            <span v-if="p.rank" class="rank-badge">{{ p.rank }}</span>
            <span v-if="p.role" class="relation-role"><RoleLabel :role-key="p.role" /></span>
            <span v-if="memberPeriod(p)" class="member-period">{{ memberPeriod(p) }}</span>
            <button
              v-if="p.description"
              class="info-marker"
              type="button"
              :aria-expanded="expandedMember === p.slug"
              aria-label="Vis forklaring"
              @click="toggleMemberInfo(p.slug)"
            >
              i
            </button>
            <div v-if="p.description && expandedMember === p.slug" class="relation-desc">
              <p class="relation-desc-text">{{ p.description }}</p>
              <SourceRef v-if="p.sourceRefs?.length" :refs="p.sourceRefs" />
            </div>
          </div>
        </div>
      </div>
    </details>

    <details class="section" open>
      <summary class="section-summary">
        <h2 class="section-heading">Lenker<span v-if="externalRefs.length"> ({{ externalRefs.length }})</span></h2>
      </summary>
      <div class="section-body">
        <div v-if="externalRefs.length" class="link-list">
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
 * UnitViewPane — read-only sections of a Unit page.
 *
 * Mirror of OrganizationViewPane structure, with Unit-specific sections:
 * sub-units, training course table, members (with info markers + KIA
 * status markers + rank badges), legacy ABOUT description stack
 * (read-only until migrated).
 *
 * `hideEditable` collapses the sections that have an editor on the page
 * (Beskrivelse + Medlemmer) so they don't double up below the EditPane.
 * The legacy ABOUT stack is NOT editable, so it stays visible in both
 * modes.
 */
import { ref, computed } from 'vue'
import RoleLabel from '@/components/role/RoleLabel.vue'
import { RouterLink } from 'vue-router'
import ImageSlider, { type SlideImage } from '@/components/ImageSlider.vue'
import DescriptionPreview from '@/components/DescriptionPreview.vue'
import SourceRef from '@/components/SourceRef.vue'
import { blocksToHtml } from '@/utils/portableText.ts'
import type { Section } from '@/components/SectionsEditor.vue'
import type {
  LegacyDescription, UnitMember, UnitCourse, UnitEvent,
  UnitSubUnit, UnitExternalRef,
} from '@/composables/useUnitData.ts'

const props = withDefaults(defineProps<{
  previewSections:    Section[]
  legacyDescriptions: LegacyDescription[]
  subUnits:           UnitSubUnit[]
  courses:            UnitCourse[]
  members:            UnitMember[]
  events:             UnitEvent[]
  externalRefs:       UnitExternalRef[]
  galleryImages:      SlideImage[]
  hideEditable?:      boolean
}>(), {
  hideEditable: false,
})


const expandedMember = ref<string | null>(null)
function toggleMemberInfo(s: string) {
  expandedMember.value = expandedMember.value === s ? null : s
}
function memberPeriod(m: UnitMember): string | null {
  if (!m.startDate && !m.endDate) return null
  return `${m.startDate ?? '?'}${m.endDate ? ` – ${m.endDate}` : ''}`
}

const eventSortAsc = ref(true)
const sortedEvents = computed(() => {
  const evts = [...props.events]
  return eventSortAsc.value
    ? evts.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
    : evts.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
})

const courseTotals = computed(() => ({
  students: props.courses.reduce((sum, c) => sum + (c.studentCount ?? 0), 0),
  missing:  props.courses.reduce((sum, c) => sum + (c.missingCount ?? 0), 0),
}))

interface RenderedDescription {
  html:         string
  recordedDate: string | null
  author:       string | null
  sourceRefs:   string[] | null
}
const legacyHtml = computed<RenderedDescription[]>(() =>
  props.legacyDescriptions.flatMap((row) => {
    if (!row.content) return []
    try {
      const blocks = JSON.parse(row.content) as unknown[]
      const html = blocksToHtml(blocks)
      if (!html) return []
      return [{
        html,
        recordedDate: row.recordedDate,
        author:       row.author,
        sourceRefs:   row.sourceRefs?.length ? row.sourceRefs : null,
      }]
    } catch { return [] }
  }),
)

// Hide attribution footer for the implicit-Jan migration signature when
// it stands alone with no citations — would be visual noise.
const MIGRATION_AUTHORS = new Set(['sanity-outline-migration', 'sanity-migration'])
function showDescriptionAttribution(d: RenderedDescription): boolean {
  if (legacyHtml.value.length > 1) return true
  if (d.sourceRefs?.length) return true
  if (d.author && !MIGRATION_AUTHORS.has(d.author)) return true
  return false
}

const MONTHS = ['januar','februar','mars','april','mai','juni','juli','august','september','oktober','november','desember']
function formatDate(iso?: string | null): string {
  if (!iso) return '–'
  const [y, m, d] = iso.split('-').map(Number)
  return `${d}. ${MONTHS[m - 1]} ${y}`
}
</script>

<style scoped>
/* Section shell — same convention as OrganizationViewPane (padding on
   summary + body, not the wrapping <details>). */
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
.section-tools {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
}
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
.event-title { font-size: 13px; color: var(--focus); flex: 1; min-width: 0; }

.relation-list { display: flex; flex-direction: column; gap: 2px; }
.relation-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.member-row { padding: 4px 0; }
.person-name-link {
  font-size: 13px;
  color: var(--focus);
  text-decoration: none;
}
.person-name-link:hover { text-decoration: underline; }

.member-period {
  font-size: 11px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

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
.rank-badge {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--focus);
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: 3px;
  padding: 2px 6px;
  white-space: nowrap;
  flex-shrink: 0;
  margin-left: auto;
}
.status-marker { font-size: 14px; flex-shrink: 0; line-height: 1; }
.status-marker--kia   { color: var(--faded-red); }
.status-marker--ambig { color: var(--muted); }

.info-marker {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid var(--rule);
  background: var(--paper-raised);
  color: var(--muted);
  font-size: 11px;
  font-weight: 700;
  font-style: italic;
  line-height: 1;
  cursor: pointer;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.1s, border-color 0.1s, color 0.1s;
  -webkit-tap-highlight-color: transparent;
}
.info-marker:hover,
.info-marker[aria-expanded="true"] {
  background: var(--focus);
  border-color: var(--focus);
  color: #fff;
}
.relation-desc {
  flex-basis: 100%;
  margin: 4px 0 2px;
  padding: 8px 10px;
  background: var(--paper);
  border-left: 3px solid var(--focus);
  border-radius: 0 3px 3px 0;
}
.relation-desc-text {
  margin: 0 0 4px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--ink);
}
.relation-desc-text:last-child { margin-bottom: 0; }

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

/* Legacy ABOUT description rendering */
.description-entry { margin: 0; }
.description-entry + .description-entry {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--rule);
}
.description-attribution {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px dashed var(--rule);
  font-size: 11px;
  color: var(--muted);
}
.description-author { font-weight: 600; color: var(--ink); }
.description-date   { font-variant-numeric: tabular-nums; }

.portable-text { margin-top: 4px; }
.portable-text :deep(p) {
  margin: 0 0 0.75em;
  font-size: 14px;
  line-height: 1.65;
  color: var(--ink);
}
.portable-text :deep(p:last-child) { margin-bottom: 0; }
.portable-text :deep(ul),
.portable-text :deep(ol) { margin: 0.5em 0 0.75em; padding-left: 1.5em; }
.portable-text :deep(li) {
  margin: 0.25em 0;
  font-size: 14px;
  line-height: 1.65;
  color: var(--ink);
}
.portable-text :deep(h1),
.portable-text :deep(h2),
.portable-text :deep(h3),
.portable-text :deep(h4) {
  font-size: 14px;
  font-weight: 700;
  margin: 1em 0 0.4em;
  color: var(--focus);
}
.portable-text :deep(strong) { font-weight: 600; }
.portable-text :deep(em)     { font-style: italic; }
.portable-text :deep(a) {
  color: var(--focus);
  text-decoration: underline;
  cursor: pointer;
}

/* Course table */
.course-table-wrap { overflow-x: auto; margin-top: 10px; }
.course-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.course-table th,
.course-table td {
  padding: 6px 10px;
  text-align: left;
  border-bottom: 1px solid var(--rule);
  white-space: nowrap;
}
.course-table th {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  background: var(--paper);
}
.course-table td.num,
.course-table th.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.course-link {
  display: inline-block;
  font-weight: 700;
  color: var(--focus);
  text-decoration: none;
  min-width: 26px;
}
.course-link:hover { text-decoration: underline; }
.course-date { color: var(--muted); font-variant-numeric: tabular-nums; }
.course-group {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}
.course-total td {
  font-weight: 700;
  border-top: 2px solid var(--rule);
  border-bottom: none;
  color: var(--ink);
  background: var(--paper);
}
</style>
