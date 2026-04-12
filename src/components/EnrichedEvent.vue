<template>
  <div class="enriched-event">
    <!-- Group badge -->
    <div class="group-badge-row">
      <span class="group-badge" :class="groupClass">{{ groupLabel }}</span>
    </div>

    <div v-if="loading" class="loading">Laster graf…</div>
    <div v-else-if="error" class="error">{{ error }}</div>

    <template v-else>
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
            :to="`/person/${p.slug}`"
            class="person-chip"
          >
            {{ p.name }}
            <span class="chip-count">{{ p.shared }}</span>
          </RouterLink>
        </div>
      </section>

      <p v-if="!relatedEvents.length && !colocatedEvents.length && !peopleNetwork.length" class="empty">
        Ingen graf-relasjoner funnet for denne hendelsen.
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { RouterLink } from 'vue-router'
import { neo4jQuery } from '../composables/useNeo4j.ts'

const props = defineProps<{ slug: string; group?: string }>()
const emit  = defineEmits<{
  'select-event-slug': [slug: string]
  'has-data': [value: boolean]
}>()

const loading = ref(false)
const error   = ref<string | null>(null)

interface RelatedEvent { slug: string; title: string; date: string; group: string; shared: number }
interface PersonNode   { slug: string; name: string; shared: number }

const relatedEvents   = ref<RelatedEvent[]>([])
const colocatedEvents = ref<RelatedEvent[]>([])
const peopleNetwork   = ref<PersonNode[]>([])

const GROUP_LABELS: Record<string, string> = {
  AirMission:       'Luftoperasjon',
  RadioStation:     'Radiostasjon',
  NNIUMission:      'NNIU Oppdrag',
  SeaPatrol:        'Sjøpatrulje',
  MaritimeCraft:    'Fartøy',
  StationOperation: 'SOE/SIS Operasjon',
  CommandoRaid:     'Kommandoangrep',
  EscapeRoute:      'Fluktrute',
  Meeting:          'Møte',
  Training:         'Kurs',
  Raid:             'Razzia',
  Sabotage:         'Sabotasje',
  Narrative:        'Historisk kontekst',
}

const groupLabel = computed(() => GROUP_LABELS[props.group ?? ''] ?? props.group ?? 'Ukjent')

function groupClass_(g: string) {
  return `group-${g?.toLowerCase().replace(/[^a-z]/g, '') ?? 'unknown'}`
}
const groupClass = computed(() => groupClass_(props.group ?? ''))

async function load(slug: string) {
  loading.value = true
  error.value   = null
  relatedEvents.value   = []
  colocatedEvents.value = []
  peopleNetwork.value   = []

  try {
    // Related events via shared people
    const related = await neo4jQuery<{ slug: string; title: string; date: string; group: string; shared: number }>(
      `MATCH (e:Event {slug: $slug})-[:INVOLVED]->(p:Person)<-[:INVOLVED]-(r:Event)
       WHERE r.slug <> $slug
       RETURN r.slug AS slug, r.title AS title, r.date AS date, r.group AS group,
              count(p) AS shared
       ORDER BY shared DESC, r.date ASC
       LIMIT 8`,
      { slug },
    )
    relatedEvents.value = related

    // Co-located events (same station or location)
    const colocated = await neo4jQuery<{ slug: string; title: string; date: string; group: string }>(
      `MATCH (e:Event {slug: $slug})-[:ORIGIN|DESTINATION|DEPARTED_FROM|ARRIVED_AT]->(place)
              <-[:ORIGIN|DESTINATION|DEPARTED_FROM|ARRIVED_AT]-(r:Event)
       WHERE r.slug <> $slug
       RETURN DISTINCT r.slug AS slug, r.title AS title, r.date AS date, r.group AS group
       ORDER BY r.date ASC
       LIMIT 8`,
      { slug },
    )
    colocatedEvents.value = colocated

    // People who worked with the same participants in other events
    const people = await neo4jQuery<{ slug: string; name: string; shared: number }>(
      `MATCH (e:Event {slug: $slug})-[:INVOLVED]->(p:Person)
              <-[:INVOLVED]-(r:Event)-[:INVOLVED]->(colleague:Person)
       WHERE NOT (e)-[:INVOLVED]->(colleague) AND colleague.slug <> p.slug
       RETURN colleague.slug AS slug, colleague.name AS name, count(DISTINCT r) AS shared
       ORDER BY shared DESC
       LIMIT 12`,
      { slug },
    )
    peopleNetwork.value = people
    emit('has-data', related.length > 0 || colocated.length > 0 || people.length > 0)
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

/* ── Sections ─────────────────────────────────────────────── */
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

/* ── Related events ───────────────────────────────────────── */
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

/* ── People network ───────────────────────────────────────── */
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
