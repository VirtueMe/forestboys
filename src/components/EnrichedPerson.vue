<template>
  <div class="enriched-person">
    <!-- Activity summary row -->
    <div v-if="!loading && !error && activityMeta" class="summary-row">
      <span class="summary-chip">{{ activityMeta.total }} hendelse{{ activityMeta.total === 1 ? '' : 'r' }}</span>
      <span v-if="activityMeta.earliest" class="date-range">
        {{ formatDate(activityMeta.earliest) }}
        <span v-if="activityMeta.latest && activityMeta.latest !== activityMeta.earliest"> — {{ formatDate(activityMeta.latest) }}</span>
      </span>
    </div>

    <div v-if="loading" class="loading">Laster graf…</div>
    <div v-else-if="error" class="error">{{ error }}</div>

    <template v-else>
      <!-- Bio: born / died from Neo4j -->
      <section v-if="personMeta" class="section bio-section">
        <h3 class="section-heading">Biografi</h3>
        <p v-if="personMeta.bornDate" class="bio-line bio-born">
          Født {{ formatFullDate(personMeta.bornDate) }}
        </p>
        <p v-if="personMeta.diedDate" class="bio-line bio-died" :class="`bio-died--${personMeta.diedType ?? 'other'}`">
          Død {{ formatFullDate(personMeta.diedDate) }}
          <span v-if="personMeta.diedType" class="log-label" :class="`log-label--${cssType(personMeta.diedType)}`">{{ diedTypeLabel(personMeta.diedType) }}</span>
        </p>
      </section>

      <!-- Chronology log entries from Neo4j -->
      <section v-if="logEntries.length" class="section">
        <h3 class="section-heading">Kronologi</h3>
        <div class="log-list">
          <div
            v-for="entry in logEntries"
            :key="entry.date + entry.text.slice(0,20)"
            class="log-entry"
            :class="{
              'log-entry--arrest':     entry.type === 'arrest',
              'log-entry--executed':   entry.type === 'executed',
              'log-entry--combat':     entry.type === 'killed-combat',
              'log-entry--flight':     entry.type === 'killed-flight',
              'log-entry--checkpoint': entry.type === 'killed-checkpoint',
            }"
          >
            <span class="log-date">{{ formatFullDate(entry.date) }}</span>
            <span class="log-text">
              <span v-if="entry.type !== 'report'" class="log-label" :class="`log-label--${cssType(entry.type)}`">{{ typeLabel(entry.type) }}</span>
              {{ entry.text }}
            </span>
          </div>
        </div>
      </section>

      <!-- Events from graph -->
      <section v-if="events.length" class="section">
        <div class="section-header-row">
          <h3 class="section-heading">Hendelser ({{ events.length }})</h3>
          <button class="sort-btn" @click="sortAsc = !sortAsc">
            Dato {{ sortAsc ? '↑' : '↓' }}
          </button>
        </div>
        <div class="event-list">
          <div
            v-for="ev in sortedEvents"
            :key="ev.slug"
            class="event-row"
            @click="emit('select-event-slug', ev.slug)"
          >
            <span class="rel-badge" :class="groupClass(ev.group)">{{ groupLabel(ev.group) }}</span>
            <span class="event-title">{{ ev.title }}</span>
            <span class="event-date">{{ ev.date ? ev.date.substring(0, 7) : '' }}</span>
          </div>
        </div>
      </section>

      <!-- Co-participants -->
      <section v-if="coParticipants.length" class="section">
        <h3 class="section-heading">Opererte sammen med</h3>
        <p class="network-hint">Rangert etter antall felles hendelser</p>
        <div class="people-grid">
          <RouterLink
            v-for="p in coParticipants"
            :key="p.slug"
            :to="`/person/${p.slug}`"
            class="person-chip"
          >
            {{ p.name }}
            <span class="chip-count">{{ p.shared }}</span>
          </RouterLink>
        </div>
      </section>

      <!-- Gallery -->
      <section v-if="gallery?.length" class="section">
        <h3 class="section-heading">Bilder ({{ gallery.length }})</h3>
        <div class="gallery-strip">
          <div
            v-for="(img, i) in gallery"
            :key="img._key"
            class="gallery-item"
            :class="{ 'gallery-item--active': i === activeImage }"
            @click="activeImage = i"
          >
            <img :src="imageUrl(img)" :alt="img.caption ?? ''" class="gallery-thumb" />
          </div>
        </div>
        <div v-if="gallery.length > 0" class="gallery-full">
          <img :src="imageUrl(gallery[activeImage])" :alt="gallery[activeImage].caption ?? ''" class="gallery-main" />
          <p v-if="gallery[activeImage].caption" class="gallery-caption">{{ gallery[activeImage].caption }}</p>
        </div>
      </section>

      <!-- Links -->
      <section v-if="links?.length" class="section kilde-section">
        <h3 class="section-heading">Nyttige lenker</h3>
        <div class="kilde-list">
          <a
            v-for="link in links"
            :key="link.url"
            :href="link.url"
            target="_blank"
            rel="noopener noreferrer"
            class="kilde-link"
          >{{ link.title || link.url }} <span class="kilde-ext">↗</span></a>
        </div>
      </section>

      <p v-if="isEmpty" class="empty">
        Ingen graf-relasjoner funnet for denne personen.
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { RouterLink } from 'vue-router'
import { neo4jQuery } from '../composables/useNeo4j.ts'
import { SANITY_IMG } from '../config/sanity.ts'
import type { IdbGalleryImage, IdbLink } from '../types/idb.ts'

const props = defineProps<{
  slug:     string
  gallery?: IdbGalleryImage[]
  links?:   IdbLink[]
}>()
const emit  = defineEmits<{
  'select-event-slug': [slug: string]
  'has-data':          [value: boolean]
}>()

const loading     = ref(false)
const error       = ref<string | null>(null)
const sortAsc     = ref(true)
const activeImage = ref(0)

function imageUrl(img: IdbGalleryImage): string {
  const path = img.asset._ref.replace(/^image-/, '').replace(/-([a-z]+)$/, '.$1')
  return `${SANITY_IMG}/${path}?w=900&auto=format`
}

watch(() => props.slug, () => { activeImage.value = 0 })

const FULL_MONTHS = ['januar','februar','mars','april','mai','juni','juli','august','september','oktober','november','desember']

function formatFullDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  // bornDate derived from birthYear only → show just the year
  if (d === 1 && m === 1 && iso.endsWith('-01-01')) return `${y}`
  return `${d}. ${FULL_MONTHS[(m ?? 1) - 1]} ${y}`
}

const DIED_LABELS: Record<string, string> = {
  'executed':          'henrettet',
  'killed-combat':     'falt i kamp',
  'killed-flight':     'under flukt',
  'killed-checkpoint': 'kontroll/razzia',
}
function diedTypeLabel(type: string): string { return DIED_LABELS[type] ?? type }

function cssType(type: string): string {
  // "killed-combat" → "combat", "killed-flight" → "flight", etc.
  return type.replace(/^killed-/, '')
}

function typeLabel(type: string): string {
  if (type === 'arrest')            return 'arrestert'
  if (type === 'executed')          return 'henrettet'
  if (type === 'killed-combat')     return 'falt i kamp'
  if (type === 'killed-flight')     return 'under flukt'
  if (type === 'killed-checkpoint') return 'kontroll/razzia'
  return ''
}

interface PersonMetaRow  { bornDate: string | null; diedDate: string | null; diedType: string | null }
interface LogEntryRow    { date: string; text: string; type: string }
interface EventRow       { slug: string; title: string; date: string; group: string }
interface CoParticipant  { slug: string; name: string; shared: number }
interface ActivityMeta   { earliest: string | null; latest: string | null; total: number }

const personMeta     = ref<PersonMetaRow | null>(null)
const logEntries     = ref<LogEntryRow[]>([])
const events         = ref<EventRow[]>([])
const coParticipants = ref<CoParticipant[]>([])
const activityMeta   = ref<ActivityMeta | null>(null)

const sortedEvents = computed(() => {
  const list = [...events.value]
  return sortAsc.value
    ? list.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
    : list.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
})

const isEmpty = computed(() =>
  !personMeta.value?.bornDate && !personMeta.value?.diedDate &&
  !logEntries.value.length && !events.value.length && !coParticipants.value.length &&
  !props.gallery?.length && !props.links?.length,
)

const GROUP_LABELS: Record<string, string> = {
  AirMission:       'Luft',
  RadioStation:     'Radio',
  NNIUMission:      'NNIU',
  SeaPatrol:        'Sjø',
  MaritimeCraft:    'Fartøy',
  StationOperation: 'SOE/SIS',
  CommandoRaid:     'Kommando',
  EscapeRoute:      'Flukt',
  Meeting:          'Møte',
  Training:         'Kurs',
  Raid:             'Razzia',
  Sabotage:         'Sabotasje',
  Narrative:        'Kontekst',
}

const MONTHS = ['jan','feb','mar','apr','mai','jun','jul','aug','sep','okt','nov','des']

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!d) return `${MONTHS[(m ?? 1) - 1]} ${y}`
  return `${d}. ${MONTHS[(m ?? 1) - 1]} ${y}`
}

function groupLabel(g: string): string {
  return GROUP_LABELS[g] ?? g ?? '?'
}

function groupClass(g: string): string {
  return `group-${(g ?? '').toLowerCase().replace(/[^a-z]/g, '') || 'unknown'}`
}

async function load(slug: string) {
  loading.value        = true
  error.value          = null
  personMeta.value     = null
  logEntries.value     = []
  events.value         = []
  coParticipants.value = []
  activityMeta.value   = null

  try {
    const [bioRows, logRows, evRows, coRows, metaRows] = await Promise.all([
      // Born / died from Person node properties
      neo4jQuery<PersonMetaRow>(
        `MATCH (p:Person {slug: $slug})
         RETURN p.bornDate AS bornDate, p.diedDate AS diedDate, p.diedType AS diedType`,
        { slug },
      ),
      // Chronology log entries
      neo4jQuery<LogEntryRow>(
        `MATCH (p:Person {slug: $slug})-[:HAS_LOG_ENTRY]->(l:PersonLogEntry)
         RETURN l.date AS date, l.text AS text, l.type AS type
         ORDER BY l.date`,
        { slug },
      ),
      // Events via graph
      neo4jQuery<EventRow>(
        `MATCH (p:Person {slug: $slug})-[:PARTICIPATED_IN]->(e:Event)
         RETURN e.slug AS slug, e.title AS title, e.date AS date, e.group AS group
         ORDER BY e.date ASC`,
        { slug },
      ),
      // Co-participants
      neo4jQuery<CoParticipant>(
        `MATCH (p:Person {slug: $slug})-[:PARTICIPATED_IN]->(e:Event)<-[:PARTICIPATED_IN]-(col:Person)
         WHERE col.slug <> $slug
         RETURN col.slug AS slug, col.name AS name, count(DISTINCT e) AS shared
         ORDER BY shared DESC
         LIMIT 20`,
        { slug },
      ),
      // Activity date range
      neo4jQuery<{ earliest: string | null; latest: string | null; total: number }>(
        `MATCH (p:Person {slug: $slug})-[:PARTICIPATED_IN]->(e:Event)
         RETURN min(e.date) AS earliest, max(e.date) AS latest, count(e) AS total`,
        { slug },
      ),
    ])

    personMeta.value     = bioRows[0] ?? null
    logEntries.value     = logRows
    events.value         = evRows
    coParticipants.value = coRows
    activityMeta.value   = metaRows[0] ?? null

    const hasBio = !!(bioRows[0]?.bornDate || bioRows[0]?.diedDate)
    emit('has-data', hasBio || logRows.length > 0 || evRows.length > 0 || coRows.length > 0 || !!props.gallery?.length || !!props.links?.length)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Graf-feil'
    emit('has-data', !!props.gallery?.length || !!props.links?.length)
  } finally {
    loading.value = false
  }
}

watch(() => props.slug, slug => { void load(slug) }, { immediate: true })
</script>

<style scoped>
.enriched-person { padding-bottom: 24px; }

/* ── Summary row ──────────────────────────────────────────────── */
.summary-row {
  padding: 12px 20px 0;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.summary-chip {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 3px 10px;
  border-radius: 12px;
  background: var(--color-border);
  color: var(--color-muted);
}

.date-range {
  font-size: 11px;
  color: var(--color-muted);
}

/* ── Loading / error / empty ──────────────────────────────────── */
.loading, .error, .empty {
  padding: 24px 20px;
  font-size: 13px;
  color: var(--color-muted);
}
.error { color: #f07070; }

/* ── Sections ─────────────────────────────────────────────────── */
.section {
  border-top: 0.5px solid var(--color-border);
  padding: 12px 20px;
  margin-top: 8px;
}

.section-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.section-heading {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--color-muted);
  margin: 0;
}

.sort-btn {
  background: none;
  border: 1px solid var(--color-border-mid);
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-muted);
  padding: 2px 8px;
  cursor: pointer;
  white-space: nowrap;
}
.sort-btn:hover { border-color: var(--color-navy); color: var(--color-navy); }

/* ── Event list ───────────────────────────────────────────────── */
.event-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.event-row {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 8px;
  padding: 6px 0;
  cursor: pointer;
  border-radius: 4px;
}
.event-row:hover .event-title { text-decoration: underline; }

.event-title {
  font-size: 13px;
  color: var(--color-text);
  flex: 1;
  min-width: 0;
  word-break: break-word;
}

.event-date {
  font-size: 11px;
  color: var(--color-muted);
  white-space: nowrap;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

/* ── Group badges ─────────────────────────────────────────────── */
.rel-badge {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 8px;
  background: var(--color-border);
  color: var(--color-muted);
  white-space: nowrap;
  flex-shrink: 0;
}

.group-airmission       { background: #1a2e4a; color: #5aa8f0; }
.group-radiostation     { background: #2a1a3a; color: #c07af0; }
.group-nniumission      { background: #1a3a2a; color: #5af0a0; }
.group-seapatrol        { background: #1a3030; color: #5af0e0; }
.group-commandoraid     { background: #3a1a1a; color: #f07070; }
.group-sabotage         { background: #3a2a1a; color: #f0b05a; }
.group-maritimecraft    { background: #1a2e3a; color: #5ad0f0; }
.group-stationoperation { background: #2a1a2a; color: #e07af0; }
.group-escaperoute      { background: #1a3a1a; color: #7af070; }

/* ── Gallery ──────────────────────────────────────────────────── */
.gallery-strip {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 6px;
  margin-bottom: 10px;
}

.gallery-item {
  flex-shrink: 0;
  width: 64px;
  height: 64px;
  border-radius: 4px;
  overflow: hidden;
  cursor: pointer;
  border: 2px solid transparent;
  opacity: 0.65;
  transition: opacity 0.15s, border-color 0.15s;
}

.gallery-item--active,
.gallery-item:hover {
  opacity: 1;
  border-color: var(--color-navy);
}

.gallery-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.gallery-full { }

.gallery-main {
  width: 100%;
  max-height: 340px;
  object-fit: contain;
  display: block;
  border-radius: 4px;
  background: var(--color-border);
}

.gallery-caption {
  font-size: 11px;
  color: var(--color-muted);
  text-align: center;
  margin: 6px 0 0;
}

/* ── Links (kilde) ────────────────────────────────────────────── */
.kilde-section {
  background: color-mix(in srgb, var(--color-border) 30%, var(--color-surface));
}

.kilde-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.kilde-link {
  font-size: 12px;
  color: var(--color-navy);
  text-decoration: none;
  line-height: 1.5;
  word-break: break-word;
}
.kilde-link:hover { text-decoration: underline; }

.kilde-ext {
  font-size: 10px;
  opacity: 0.6;
}

/* ── Bio section ──────────────────────────────────────────────── */
.bio-section {
  background: color-mix(in srgb, var(--color-navy) 6%, var(--color-surface));
  border-left: 3px solid var(--color-navy);
}

.bio-line {
  font-size: 13px;
  line-height: 1.7;
  color: var(--color-text);
  margin: 0 0 2px;
}
.bio-line:last-child { margin-bottom: 0; }

.bio-born {
  font-weight: 600;
  color: var(--color-muted);
  font-size: 12px;
  margin-bottom: 6px;
}

/* ── Chronology log ───────────────────────────────────────────── */
.log-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.log-entry {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 10px;
  align-items: baseline;
}

.log-date {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-muted);
  white-space: nowrap;
  flex-shrink: 0;
}

.log-entry--arrest     .log-date { color: #c07040; }
.log-entry--executed   .log-date { color: #a03030; }
.log-entry--combat     .log-date { color: #8a3030; }
.log-entry--flight     .log-date { color: #406080; }
.log-entry--checkpoint .log-date { color: #7a4020; }

.log-text {
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-text);
}

.log-label {
  display: inline-block;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  border-radius: 4px;
  padding: 1px 5px;
  margin-right: 5px;
  vertical-align: middle;
}
.log-label--arrest {
  color: #f09050;
  background: rgba(240, 144, 80, 0.12);
}
.log-label--executed {
  color: #f07070;
  background: rgba(240, 112, 112, 0.12);
}
.log-label--combat {
  color: #e06060;
  background: rgba(200, 80, 80, 0.12);
}
.log-label--flight {
  color: #70a0c0;
  background: rgba(80, 140, 180, 0.12);
}
.log-label--checkpoint {
  color: #e0a060;
  background: rgba(200, 140, 60, 0.12);
}

/* ── Co-participants ──────────────────────────────────────────── */
.network-hint {
  font-size: 11px;
  color: var(--color-muted);
  margin: 0 0 8px;
}

.people-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.person-chip {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--color-navy);
  background: var(--color-border);
  padding: 4px 10px;
  border-radius: 12px;
  text-decoration: none;
}
.person-chip:hover { background: var(--color-border-mid); }

.chip-count {
  font-size: 10px;
  color: var(--color-muted);
  background: var(--color-surface);
  padding: 1px 5px;
  border-radius: 8px;
}
</style>
