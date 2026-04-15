<template>
  <div class="enriched-event">
    <!-- Group badge + date range -->
    <div class="group-badge-row">
      <span class="group-badge" :class="groupClass">{{ groupLabel }}</span>
      <span v-if="startDate || endDate" class="date-range">
        {{ startDate ? formatDate(startDate) : '?' }}
        <span v-if="endDate"> — {{ formatDate(endDate) }}</span>
      </span>
    </div>

    <div v-if="loading" class="loading">Laster graf…</div>
    <div v-else-if="error" class="error">{{ error }}</div>

    <template v-else>
      <!-- ══ Planet operation view ════════════════════════════════ -->
      <template v-if="eventGroup === 'PlanetOperation'">
        <!-- Header: name + region + system label -->
        <div class="planet-header">
          <span v-if="planetName" class="planet-name">{{ planetName }}</span>
          <span v-if="planetRegion" class="planet-region-badge">{{ planetRegion }}</span>
          <span class="planet-system">Planetgrupper · FO4 UK / MI4 Stockholm</span>
        </div>

        <!-- Location hierarchy -->
        <section v-if="planetLocations.length" class="section">
          <h3 class="section-heading">Organisasjon</h3>
          <div class="planet-hierarchy">
            <template v-for="loc in planetLocations" :key="loc.id">
              <div class="planet-loc" :class="`planet-loc--${loc.type.toLowerCase().replace(/[^a-z]/g,'')}`">
                <span class="planet-loc-type">{{ loc.type }}</span>
                <span class="planet-loc-name">{{ loc.name }}</span>
                <span class="planet-loc-status" :class="loc.status === 'Aktiv' ? 'status--aktiv' : 'status--planlagt'">
                  {{ loc.status }}
                </span>
                <span v-if="loc.lat" class="planet-loc-coords">{{ loc.lat.toFixed(4) }}, {{ loc.lng?.toFixed(4) }}</span>
              </div>
            </template>
          </div>
        </section>

        <!-- Personnel roster -->
        <section v-if="planetMembers.length" class="section">
          <h3 class="section-heading">Mannskap ({{ planetMembers.length }})</h3>
          <div class="planet-roster">
            <div
              v-for="m in planetMembers"
              :key="m.personSlug"
              class="planet-roster-row"
            >
              <RouterLink :to="`/person/${m.personSlug}#beriket`" class="planet-roster-name">
                {{ m.name }}
              </RouterLink>
              <span v-if="m.codename" class="planet-codename">«{{ m.codename }}»</span>
              <span v-if="m.arrivedSweden" class="planet-date">{{ formatDate(m.arrivedSweden) }}</span>
            </div>
          </div>
        </section>

        <!-- Training batches -->
        <section v-if="planetBatches.length" class="section">
          <h3 class="section-heading">Åhlby-kull</h3>
          <div class="planet-batches">
            <div v-for="batch in planetBatches" :key="batch.id" class="planet-batch">
              <div class="planet-batch-date">{{ formatDate(batch.date) }}</div>
              <div class="planet-batch-members">
                <template v-for="(m, i) in batch.members" :key="m.personSlug">
                  <RouterLink :to="`/person/${m.personSlug}#beriket`" class="planet-batch-member">
                    {{ m.name }}<span v-if="m.codename"> «{{ m.codename }}»</span>
                  </RouterLink>
                  <span v-if="i < batch.members.length - 1" class="planet-batch-sep">, </span>
                </template>
              </div>
            </div>
          </div>
        </section>
      </template>
      <!-- ══ end Planet ═══════════════════════════════════════════ -->

      <!-- Named sections (Oppdrag, Personell, etc.) -->
      <section
        v-for="sec in namedSections"
        :key="sec.type"
        class="section"
        :class="{ 'mission-brief': sec.type === 'oppdrag' }"
      >
        <h3 class="section-heading">{{ sec.heading }}</h3>
        <!-- People-bearing sections: segmented name list + narrative -->
        <div v-if="PEOPLE_SECTION_KEYS.has(sec.type)" class="people-section-body">
          <template v-for="(seg, i) in segmentPeopleSection(sec.body)" :key="i">
            <RouterLink
              v-if="seg.type === 'name-linked'"
              :to="`/person/${seg.slug}#beriket`"
              class="people-name people-name--linked"
            >
              {{ seg.text }}
            </RouterLink>
            <span v-else-if="seg.type === 'name-plain'" class="people-name people-name--plain">{{ seg.text }}</span>
            <p v-else-if="seg.type === 'note'" class="people-note">{{ seg.text }}</p>
            <p v-else class="people-prose">{{ seg.text }}</p>
          </template>
        </div>
        <pre v-else-if="sec.body.includes('\t')" class="section-pre">{{ sec.body }}</pre>
        <p v-else class="section-text">{{ sec.body }}</p>
      </section>

      <!-- Uncategorized description content -->
      <section v-if="contentSection" class="section content-section">
        <h3 class="section-heading">Beskrivelse</h3>
        <pre v-if="contentSection.body.includes('\t')" class="section-pre">{{ contentSection.body.replace(/^([^\n]*\t[^\n]*)\n\n(?=[^\n]*\t)/gm, '$1\n') }}</pre>
        <p v-else class="section-text">{{ contentSection.body }}</p>
      </section>

      <!-- Dated log entries -->
      <section v-if="logEntries.length" class="section">
        <h3 class="section-heading">Logg ({{ logEntries.length }})</h3>
        <div class="log-list">
          <div
            v-for="entry in logEntries"
            :key="entry.date + entry.text.slice(0,20)"
            class="log-entry"
            :class="{
              'log-entry--arrest': entry.type === 'arrest',
              'log-entry--executed': entry.type === 'executed',
              'log-entry--combat': entry.type === 'killed-combat',
              'log-entry--flight': entry.type === 'killed-flight',
              'log-entry--checkpoint': entry.type === 'killed-checkpoint',
            }"
          >
            <button class="log-date" @click="emit('select-date', entry.date)">
              {{ formatDate(entry.date) }}
            </button>
            <span class="log-text">
              <span v-if="entry.type === 'arrest'" class="entry-label label--arrest">arrestert</span>
              <span v-else-if="entry.type === 'executed'" class="entry-label label--executed">henrettet</span>
              <span v-else-if="entry.type === 'killed-combat'" class="entry-label label--combat">falt i kamp</span>
              <span v-else-if="entry.type === 'killed-flight'" class="entry-label label--flight">under flukt</span>
              <span v-else-if="entry.type === 'killed-checkpoint'" class="entry-label label--checkpoint">kontroll/razzia</span>
              {{ entry.text }}
            </span>
          </div>
        </div>
      </section>

      <!-- Related events via shared people -->
      <section v-if="relatedEvents.length" class="section">
        <h3 class="section-heading">Relaterte hendelser (felles deltakere)</h3>
        <div
          v-for="rel in relatedEvents"
          :key="rel.slug"
          class="related-row"
          @click="emit('select-event-slug', rel.slug)"
        >
          <span class="rel-badge" :class="groupClass_(rel.group)">{{ rel.group }}</span>
          <span class="rel-title">{{ rel.title }}</span>
          <span class="rel-meta">{{ rel.date ? rel.date.substring(0, 7) : '' }} · {{ rel.shared }}✕</span>
        </div>
      </section>

      <!-- Co-located events (same station or location) -->
      <section v-if="colocatedEvents.length" class="section">
        <h3 class="section-heading">Andre hendelser på samme sted</h3>
        <div
          v-for="co in colocatedEvents"
          :key="co.slug"
          class="related-row"
          @click="emit('select-event-slug', co.slug)"
        >
          <span class="rel-badge" :class="groupClass_(co.group)">{{ co.group }}</span>
          <span class="rel-title">{{ co.title }}</span>
          <span class="rel-meta">{{ co.date ? co.date.substring(0, 7) : '' }}</span>
        </div>
      </section>

      <!-- People network -->
      <section v-if="peopleNetwork.length" class="section">
        <h3 class="section-heading">Deltakernettverk</h3>
        <p class="network-hint">Andre som opererte med de samme menneskene</p>
        <div class="people-grid">
          <RouterLink
            v-for="p in peopleNetwork"
            :key="p.slug"
            :to="`/person/${p.slug}#beriket`"
            class="person-chip"
          >
            {{ p.name }}
            <span class="chip-count">{{ p.shared }}</span>
          </RouterLink>
        </div>
      </section>

      <!-- Sources (nyttige lenker) -->
      <section v-if="links?.length" class="section kilde-section">
        <h3 class="section-heading">Kilder</h3>
        <div class="kilde-list">
          <a
            v-for="link in links"
            :key="link._key"
            :href="link.link"
            target="_blank"
            rel="noopener noreferrer"
            class="kilde-link"
          >{{ link.title || link.link }} <span class="kilde-ext">↗</span></a>
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

      <p v-if="isEmpty" class="empty">
        Ingen graf-relasjoner funnet for denne hendelsen.
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { RouterLink } from 'vue-router'
import { neo4jQuery } from '../composables/useNeo4j.ts'
import { SANITY_IMG } from '../config/sanity.ts'
import type { IdbGalleryImage } from '../types/idb.ts'

interface EventLink { _key: string; title?: string; link: string }

const props = defineProps<{
  slug:     string
  gallery?: IdbGalleryImage[]
  links?:   EventLink[]
}>()
const emit  = defineEmits<{
  'select-event-slug': [slug: string]
  'select-date':       [date: string]   // ISO date clicked in log
  'has-data':          [value: boolean]
}>()

const activeImage = ref(0)

function imageUrl(img: IdbGalleryImage): string {
  const path = (img.asset._ref).replace(/^image-/, '').replace(/-([a-z]+)$/, '.$1')
  return `${SANITY_IMG}/${path}?w=900&auto=format`
}

watch(() => props.slug, () => { activeImage.value = 0 })

const loading    = ref(false)
const error      = ref<string | null>(null)
const eventGroup = ref<string | null>(null)
const startDate  = ref<string | null>(null)
const endDate    = ref<string | null>(null)

interface SectionNode      { type: string; heading: string; body: string; importance: number }
interface LogEntryNode     { date: string; text: string; type: string }
interface RelatedEvent     { slug: string; title: string; date: string; group: string; shared: number }
interface PersonNode       { slug: string; name: string; shared: number }
interface DirectPersonNode { slug: string; name: string }

// Planet-specific
interface PlanetLocation   { id: string; name: string; type: string; status: string; lat: number | null; lng: number | null }
interface PlanetMember     { personSlug: string; name: string; codename: string | null; arrivedSweden: string | null; aahlyDate: string | null; batchId: string | null }
interface PlanetBatch      { id: string; date: string; members: PlanetMember[] }

const PEOPLE_SECTION_KEYS = new Set([
  'bemanning', 'crew', 'mannskap', 'styrke', 'agenter',
  'passasjerer', 'landsatte', 'personell', 'deltakere', 'squad',
])

const allSections     = ref<SectionNode[]>([])
const logEntries      = ref<LogEntryNode[]>([])
const relatedEvents   = ref<RelatedEvent[]>([])
const colocatedEvents = ref<RelatedEvent[]>([])
const peopleNetwork   = ref<PersonNode[]>([])
const directPeople    = ref<DirectPersonNode[]>([])

// Planet-specific
const planetName      = ref<string | null>(null)
const planetRegion    = ref<string | null>(null)
const planetLocations = ref<PlanetLocation[]>([])
const planetMembers   = ref<PlanetMember[]>([])
const planetBatches   = ref<PlanetBatch[]>([])

/** Normalise a name for loose matching: lowercase, collapse whitespace, strip punctuation */
function normName(s: string): string {
  return s.trim().toLowerCase().replace(/[.,\-/]/g, ' ').replace(/\s+/g, ' ')
}

/** Collapse consecutive duplicate consonants: "Johannessen" → "Johannesen" */
function dedup(s: string): string {
  return s.replace(/([bcdfghjklmnpqrstvwxyzæøå])\1+/gi, '$1')
}

/** Try to match a short string against directPeople; returns slug or null */
function matchPerson(line: string): { text: string; slug: string | null } {
  const clean = line.trim()
  if (!clean) return { text: clean, slug: null }
  const norm = normName(clean)
  const cLast = norm.split(' ').filter(w => w.length >= 2).at(-1)

  const lastWordMatches: DirectPersonNode[] = []
  const dedupMatches:    DirectPersonNode[] = []

  for (const p of directPeople.value) {
    const pNorm = normName(p.name)
    // 1. Exact normalized match — return immediately
    if (pNorm === norm) return { text: p.name, slug: p.slug }
    if (!cLast) continue
    const pLast = pNorm.split(' ').filter(w => w.length >= 2).at(-1)
    if (!pLast) continue
    // Collect candidates for last-word matching
    if (cLast === pLast)                    lastWordMatches.push(p)
    else if (dedup(cLast) === dedup(pLast)) dedupMatches.push(p)
  }

  // 2. Unique last-word match
  if (lastWordMatches.length === 1) return { text: lastWordMatches[0].name, slug: lastWordMatches[0].slug }
  // 3. Unique double-consonant-normalised last-word (Johannessen ↔ Johannesen)
  if (dedupMatches.length === 1)    return { text: dedupMatches[0].name,    slug: dedupMatches[0].slug }
  return { text: clean, slug: null }
}

type LineType = 'name-linked' | 'name-plain' | 'note' | 'prose'
interface SectionLine { type: LineType; text: string; slug?: string }

/** Segment a people-bearing section body into typed lines for rendering */
function segmentPeopleSection(body: string): SectionLine[] {
  const result: SectionLine[] = []
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (!line) continue

    // Parenthetical editorial notes
    if (line.startsWith('(')) {
      result.push({ type: 'note', text: line })
      continue
    }

    // Try person match
    const m = matchPerson(line)
    if (m.slug) {
      result.push({ type: 'name-linked', text: m.text, slug: m.slug })
      continue
    }

    // Short capitalised line with no sentence structure → unlinked name
    const looksLikeName =
      line.length <= 55 &&
      /^[A-ZÆØÅ]/.test(line) &&
      !/\s(var|ble|har|som|og|med|til|fra|på|i|er|det|han|hun|de|den)\s/.test(line)

    if (looksLikeName) {
      result.push({ type: 'name-plain', text: line })
      continue
    }

    result.push({ type: 'prose', text: line })
  }
  return result
}

const namedSections  = computed(() => allSections.value.filter(s => s.type !== 'content' && s.type !== 'kilde'))
const contentSection = computed(() => allSections.value.find(s => s.type === 'content') ?? null)

const isEmpty = computed(() =>
  !namedSections.value.length &&
  !contentSection.value &&
  !logEntries.value.length &&
  !relatedEvents.value.length &&
  !colocatedEvents.value.length &&
  !peopleNetwork.value.length &&
  !props.links?.length &&
  !props.gallery?.length,
)

const GROUP_LABELS: Record<string, string> = {
  AirMission:       'Luftoperasjon',
  RadioStation:     'Radiostasjon',
  NNIUMission:      'NNIU Oppdrag',
  SeaPatrol:        'Sjøpatrulje',
  MaritimeCraft:    'Fartøy',
  StationOperation: 'SOE/SIS Operasjon',
  PlanetOperation:  'Planet-operasjon',
  CommandoRaid:     'Kommandoangrep',
  EscapeRoute:      'Fluktrute',
  Meeting:          'Møte',
  Training:         'Kurs',
  Raid:             'Razzia',
  Sabotage:         'Sabotasje',
  Narrative:        'Historisk kontekst',
}

const MONTHS = ['jan','feb','mar','apr','mai','jun','jul','aug','sep','okt','nov','des']

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d}. ${MONTHS[m - 1]} ${y}`
}

const groupLabel = computed(() => GROUP_LABELS[eventGroup.value ?? ''] ?? eventGroup.value ?? 'Ukjent')

function groupClass_(g: string) {
  return `group-${g?.toLowerCase().replace(/[^a-z]/g, '') ?? 'unknown'}`
}
const groupClass = computed(() => groupClass_(eventGroup.value ?? ''))

async function load(slug: string) {
  loading.value = true
  error.value   = null
  eventGroup.value      = null
  startDate.value       = null
  endDate.value         = null
  allSections.value     = []
  logEntries.value      = []
  relatedEvents.value   = []
  colocatedEvents.value = []
  peopleNetwork.value   = []
  directPeople.value    = []
  planetName.value      = null
  planetRegion.value    = null
  planetLocations.value = []
  planetMembers.value   = []
  planetBatches.value   = []

  try {
    const [meta, secs, logs, related, colocated, people, direct] = await Promise.all([
      // Event group + date range
      neo4jQuery<{ group: string; startDate: string | null; endDate: string | null }>(
        `MATCH (e:Event {slug: $slug}) RETURN e.group AS group, e.startDate AS startDate, e.endDate AS endDate`,
        { slug },
      ),
      // Section nodes ordered by importance
      neo4jQuery<SectionNode>(
        `MATCH (e:Event {slug: $slug})-[:HAS_SECTION]->(s:Section)
         RETURN s.type AS type, s.heading AS heading, s.body AS body, s.importance AS importance
         ORDER BY s.importance`,
        { slug },
      ),
      // Log entries ordered by date
      neo4jQuery<LogEntryNode>(
        `MATCH (e:Event {slug: $slug})-[:HAS_LOG_ENTRY]->(l:LogEntry)
         RETURN l.date AS date, l.text AS text, l.type AS type
         ORDER BY l.date`,
        { slug },
      ),
      // Related events via shared people
      neo4jQuery<RelatedEvent>(
        `MATCH (p:Person)-[:PARTICIPATED_IN]->(e:Event {slug: $slug})
         MATCH (p)-[:PARTICIPATED_IN]->(r:Event)
         WHERE r.slug <> $slug
         RETURN r.slug AS slug, r.title AS title, r.date AS date, r.group AS group,
                count(p) AS shared
         ORDER BY shared DESC, r.date ASC
         LIMIT 8`,
        { slug },
      ),
      // Co-located events
      neo4jQuery<RelatedEvent>(
        `MATCH (e:Event {slug: $slug})-[:ORIGIN|DESTINATION|DEPARTED_FROM|ARRIVED_AT]->(place)
                <-[:ORIGIN|DESTINATION|DEPARTED_FROM|ARRIVED_AT]-(r:Event)
         WHERE r.slug <> $slug
         RETURN DISTINCT r.slug AS slug, r.title AS title, r.date AS date, r.group AS group
         ORDER BY r.date ASC
         LIMIT 8`,
        { slug },
      ),
      // People network
      neo4jQuery<{ slug: string; name: string; shared: number }>(
        `MATCH (p:Person)-[:PARTICIPATED_IN]->(e:Event {slug: $slug})
         MATCH (p)-[:PARTICIPATED_IN]->(r:Event)<-[:PARTICIPATED_IN]-(colleague:Person)
         WHERE NOT (colleague)-[:PARTICIPATED_IN]->(e) AND colleague.slug <> p.slug
         RETURN colleague.slug AS slug, colleague.name AS name, count(DISTINCT r) AS shared
         ORDER BY shared DESC
         LIMIT 12`,
        { slug },
      ),
      // Direct participants
      neo4jQuery<DirectPersonNode>(
        `MATCH (p:Person)-[:PARTICIPATED_IN]->(e:Event {slug: $slug})
         RETURN p.slug AS slug, p.name AS name
         ORDER BY p.name`,
        { slug },
      ),
    ])

    eventGroup.value      = meta[0]?.group ?? null
    startDate.value       = meta[0]?.startDate ?? null
    endDate.value         = meta[0]?.endDate ?? null
    allSections.value     = secs
    logEntries.value      = logs
    relatedEvents.value   = related
    colocatedEvents.value = colocated
    peopleNetwork.value   = people
    directPeople.value    = direct

    // Planet-specific data
    if (meta[0]?.group === 'PlanetOperation') {
      const [opMeta, locs, members] = await Promise.all([
        neo4jQuery<{ name: string; region: string }>(
          `MATCH (e:Event {slug: $slug})-[:DESCRIBES]->(o:Operation)
           RETURN o.name AS name, o.region AS region`,
          { slug },
        ),
        neo4jQuery<PlanetLocation>(
          `MATCH (e:Event {slug: $slug})-[:DESCRIBES]->(o:Operation)
           MATCH (o)-[:HQ_AT|HAS_UNIT]->(l:Location)
           RETURN l.id AS id, l.name AS name, l.type AS type,
                  l.status AS status, l.lat AS lat, l.lng AS lng
           ORDER BY l.type`,
          { slug },
        ),
        neo4jQuery<{ personSlug: string; name: string; codename: string | null; arrivedSweden: string | null; aahlyDate: string | null; batchId: string | null }>(
          `MATCH (e:Event {slug: $slug})-[:DESCRIBES]->(o:Operation)
           MATCH (p:Person)-[m:MEMBER_OF]->(o)
           OPTIONAL MATCH (p)-[r:TRAINED_IN]->(b:TrainingBatch)-[:PREPARED_FOR]->(o)
           RETURN p.slug AS personSlug, p.name AS name, m.codename AS codename,
                  r.arrived_sweden AS arrivedSweden, b.date AS aahlyDate, b.id AS batchId
           ORDER BY p.name`,
          { slug },
        ),
      ])

      planetName.value   = opMeta[0]?.name   ?? null
      planetRegion.value = opMeta[0]?.region ?? null
      planetLocations.value = locs

      planetMembers.value = members
      // Build training batches: group members by aahlyDate
      const batchMap = new Map<string, PlanetBatch>()
      for (const m of members) {
        if (m.aahlyDate && m.batchId) {
          if (!batchMap.has(m.batchId)) batchMap.set(m.batchId, { id: m.batchId, date: m.aahlyDate, members: [] })
          batchMap.get(m.batchId)!.members.push(m)
        }
      }
      planetBatches.value = [...batchMap.values()].sort((a, b) => a.date.localeCompare(b.date))
    }

    emit('has-data',
      secs.length > 0 || logs.length > 0 ||
      related.length > 0 || colocated.length > 0 || people.length > 0 ||
      planetMembers.value.length > 0,
    )
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Graf-feil'
    emit('has-data', false)
  } finally {
    loading.value = false
  }
}

watch(() => props.slug, slug => { void load(slug) }, { immediate: true })
</script>

<style scoped>
.enriched-event { padding-bottom: 24px; }

.group-badge-row {
  padding: 12px 20px 0;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.date-range {
  font-size: 11px;
  color: var(--color-muted);
}

.group-badge {
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

/* Group colour tints */
.group-airmission       { background: #1a2e4a; color: #5aa8f0; }
.group-radiostasjon,
.group-radiostation     { background: #2a1a3a; color: #c07af0; }
.group-nniuoppdrag,
.group-nniuoppd,
.group-nniumission      { background: #1a3a2a; color: #5af0a0; }
.group-sjøpatrulje,
.group-seapatrol        { background: #1a3030; color: #5af0e0; }
.group-commandoraid     { background: #3a1a1a; color: #f07070; }
.group-sabotage         { background: #3a2a1a; color: #f0b05a; }

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

.section-heading {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--color-muted);
  margin: 0 0 8px;
}

.section-text {
  font-size: 13px;
  line-height: 1.7;
  color: var(--color-text);
  margin: 0;
  white-space: pre-wrap;
}

.section-pre {
  font-family: 'Courier New', Courier, monospace;
  font-size: 11px;
  white-space: pre-wrap;
  overflow-x: auto;
  background: color-mix(in srgb, var(--color-border) 50%, var(--color-surface));
  border-radius: 3px;
  padding: 8px 10px;
  line-height: 1.65;
  color: var(--color-text);
  margin: 0;
}

/* ── Mission brief ────────────────────────────────────────────── */
.mission-brief {
  background: color-mix(in srgb, var(--color-navy) 6%, var(--color-surface));
  border-left: 3px solid var(--color-navy);
  border-top: none;
  padding-left: 16px;
}
/* ── Content section ──────────────────────────────────────────── */
.content-section .section-text {
  color: var(--color-muted);
  font-size: 12px;
}

/* ── Log entries ──────────────────────────────────────────────── */
.log-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.log-entry {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 8px;
  align-items: baseline;
}

.log-date {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-navy);
  background: none;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 2px 6px;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  line-height: 1.4;
}
.log-date:hover {
  background: color-mix(in srgb, var(--color-navy) 8%, var(--color-surface));
  border-color: var(--color-navy);
}

.log-text {
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-text);
}

.log-entry--arrest     .log-date { border-color: #7a4020; color: #f09050; }
.log-entry--executed   .log-date { border-color: #7a2020; color: #f07070; }
.log-entry--combat     .log-date { border-color: #6a2020; color: #e06060; }
.log-entry--flight     .log-date { border-color: #2a4060; color: #70a0c0; }
.log-entry--checkpoint .log-date { border-color: #6a3010; color: #e0a060; }

.log-entry--arrest     .log-text,
.log-entry--executed   .log-text,
.log-entry--combat     .log-text,
.log-entry--flight     .log-text,
.log-entry--checkpoint .log-text { color: var(--color-muted); }

.entry-label {
  display: inline-block;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  border-radius: 4px;
  padding: 1px 5px;
  margin-right: 4px;
  vertical-align: middle;
}
.label--arrest     { color: #f09050; background: rgba(240, 144,  80, 0.12); }
.label--executed   { color: #f07070; background: rgba(240, 112, 112, 0.12); }
.label--combat     { color: #e06060; background: rgba(200,  80,  80, 0.12); }
.label--flight     { color: #70a0c0; background: rgba( 80, 140, 180, 0.12); }
.label--checkpoint { color: #e0a060; background: rgba(200, 140,  60, 0.12); }

/* ── Related events ───────────────────────────────────────────── */
.related-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 5px 0;
  cursor: pointer;
  border-radius: 4px;
}
.related-row:hover .rel-title { text-decoration: underline; }

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

.rel-title {
  font-size: 13px;
  color: var(--color-text);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rel-meta {
  font-size: 11px;
  color: var(--color-muted);
  white-space: nowrap;
  flex-shrink: 0;
}

/* ── People network ───────────────────────────────────────────── */
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

/* ── People section body ──────────────────────────────────────── */
.people-section-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.people-name {
  font-size: 13px;
  font-weight: 500;
  line-height: 1.6;
}
.people-name--linked {
  color: var(--color-navy);
  text-decoration: none;
}
.people-name--linked:hover { text-decoration: underline; }
.people-name--plain {
  color: var(--color-text);
}

.people-note {
  font-size: 12px;
  color: var(--color-muted);
  font-style: italic;
  margin: 6px 0 2px;
  line-height: 1.6;
}

.people-prose {
  font-size: 13px;
  color: var(--color-text);
  line-height: 1.75;
  margin: 6px 0 0;
  white-space: pre-wrap;
}

/* ── Sources (kilde) ──────────────────────────────────────────── */
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

/* ── Planet operation display ─────────────────────────────────────────────── */
.planet-header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 14px 20px 10px;
  border-bottom: 0.5px solid var(--color-border);
}

.planet-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--color-text);
}

.planet-region-badge {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 2px 8px;
  border-radius: 10px;
  background: #1a2e4a;
  color: #5aa8f0;
}

.planet-system {
  font-size: 11px;
  color: var(--color-muted);
  margin-left: auto;
}

/* Hierarchy */
.planet-hierarchy {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.planet-loc {
  display: grid;
  grid-template-columns: 60px 1fr auto auto;
  align-items: baseline;
  gap: 8px;
  padding: 3px 0;
  font-size: 13px;
}

.planet-loc--hq { padding-left: 0; }
.planet-loc--depot { padding-left: 8px; }
.planet-loc--amøbe { padding-left: 16px; }
.planet-loc--bicelle { padding-left: 28px; }

.planet-loc-type {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-muted);
}

.planet-loc-name {
  color: var(--color-text);
  font-weight: 500;
}

.planet-loc-coords {
  font-size: 10px;
  color: var(--color-muted);
  font-family: 'Courier New', monospace;
}

.status--aktiv    { font-size: 10px; color: #5af0a0; }
.status--planlagt { font-size: 10px; color: var(--color-muted); }

/* Roster */
.planet-roster {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.planet-roster-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}

.planet-roster-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-navy);
  text-decoration: none;
}
.planet-roster-name:hover { text-decoration: underline; }

.planet-codename {
  font-size: 12px;
  color: var(--color-muted);
  font-style: italic;
}

.planet-date {
  font-size: 11px;
  color: var(--color-muted);
  margin-left: auto;
}

/* Training batches */
.planet-batches {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.planet-batch {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 10px;
  align-items: baseline;
}

.planet-batch-date {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-navy);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 2px 6px;
  white-space: nowrap;
}

.planet-batch-members {
  font-size: 12px;
  color: var(--color-text);
  line-height: 1.6;
}

.planet-batch-member {
  color: var(--color-navy);
  text-decoration: none;
}
.planet-batch-member:hover { text-decoration: underline; }

.planet-batch-sep { color: var(--color-muted); }
</style>
