<template>
  <div class="date-panel">
    <!-- Navigation header -->
    <div class="date-nav">
      <button class="nav-btn" :disabled="!prevDate" @click="go(prevDate!)">
        ‹ <span v-if="prevDate">{{ formatShort(prevDate) }}</span>
      </button>
      <span class="date-current">{{ formatDate(date) }}</span>
      <button class="nav-btn nav-btn--right" :disabled="!nextDate" @click="go(nextDate!)">
        <span v-if="nextDate">{{ formatShort(nextDate) }}</span> ›
      </button>
    </div>

    <div v-if="loading" class="loading">Laster…</div>
    <div v-else-if="error" class="error">{{ error }}</div>

    <template v-else>
      <div v-if="!rows.length" class="empty">Ingen aktivitet registrert denne dagen.</div>

      <!-- Group rows -->
      <div
        v-for="row in rows"
        :key="row.slug + (row.log ?? '')"
        class="day-row"
        @click="row.slug && emit('select-event-slug', row.slug)"
      >
        <span class="day-badge" :class="groupClass(row.group)">{{ groupLabel(row.group) }}</span>
        <div class="day-content">
          <span class="day-title">{{ row.title }}</span>
          <span v-if="row.log" class="day-log">{{ row.log }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { neo4jQuery } from '../composables/useNeo4j.ts'

const props = defineProps<{ date: string }>()
const emit  = defineEmits<{
  'select-event-slug': [slug: string]
  'navigate':          [date: string]
}>()

interface DayRow { slug: string; title: string; group: string; log: string | null }

const loading  = ref(false)
const error    = ref<string | null>(null)
const rows     = ref<DayRow[]>([])
const prevDate = ref<string | null>(null)
const nextDate = ref<string | null>(null)

const MONTHS = ['jan','feb','mar','apr','mai','jun','jul','aug','sep','okt','nov','des']

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d}. ${MONTHS[m - 1]} ${y}`
}
function formatShort(iso: string): string {
  const [, m, d] = iso.split('-').map(Number)
  return `${d}. ${MONTHS[m - 1]}`
}

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
function groupLabel(g: string) { return GROUP_LABELS[g] ?? g }
function groupClass(g: string) { return `badge-${g?.toLowerCase().replace(/[^a-z]/g, '') ?? 'unknown'}` }

function go(d: string) { emit('navigate', d) }

async function load(date: string) {
  loading.value  = true
  error.value    = null
  rows.value     = []
  prevDate.value = null
  nextDate.value = null

  try {
    const [dayRows, prev, next] = await Promise.all([
      // All activity on this date: field events + log entries
      neo4jQuery<DayRow>(
        `CALL {
           MATCH (e:Event) WHERE e.date = $date
           RETURN e.slug AS slug, e.title AS title, e.group AS group, null AS log
           UNION ALL
           MATCH (e:Event)-[:HAS_LOG_ENTRY]->(l:LogEntry {date: $date})
           RETURN e.slug AS slug, e.title AS title, e.group AS group, l.text AS log
         }
         RETURN slug, title, group, log
         ORDER BY group, slug`,
        { date },
      ),
      // Previous date with any activity
      neo4jQuery<{ d: string }>(
        `CALL {
           MATCH (e:Event) WHERE e.date < $date AND e.date IS NOT NULL RETURN e.date AS d
           UNION ALL
           MATCH (:Event)-[:HAS_LOG_ENTRY]->(l:LogEntry) WHERE l.date < $date RETURN l.date AS d
         }
         RETURN max(d) AS d`,
        { date },
      ),
      // Next date with any activity
      neo4jQuery<{ d: string }>(
        `CALL {
           MATCH (e:Event) WHERE e.date > $date AND e.date IS NOT NULL RETURN e.date AS d
           UNION ALL
           MATCH (:Event)-[:HAS_LOG_ENTRY]->(l:LogEntry) WHERE l.date > $date RETURN l.date AS d
         }
         RETURN min(d) AS d`,
        { date },
      ),
    ])

    rows.value     = dayRows
    prevDate.value = prev[0]?.d ?? null
    nextDate.value = next[0]?.d ?? null
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Feil ved lasting av dag'
  } finally {
    loading.value = false
  }
}

watch(() => props.date, d => { void load(d) }, { immediate: true })
</script>

<style scoped>
.date-panel {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
  padding-bottom: 24px;
}

/* ── Navigation ───────────────────────────────────────────────── */
.date-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border);
  gap: 8px;
}

.date-current {
  font-size: 14px;
  font-weight: 700;
  color: var(--color-text);
  text-align: center;
  flex: 1;
}

.nav-btn {
  font-size: 12px;
  color: var(--color-navy);
  background: none;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 3px 8px;
  cursor: pointer;
  white-space: nowrap;
  min-width: 64px;
  line-height: 1.4;
}
.nav-btn--right { text-align: right; }
.nav-btn:disabled { opacity: 0.3; cursor: default; }
.nav-btn:not(:disabled):hover {
  border-color: var(--color-navy);
  background: color-mix(in srgb, var(--color-navy) 6%, var(--color-surface));
}

/* ── Rows ─────────────────────────────────────────────────────── */
.loading, .error, .empty {
  padding: 20px;
  font-size: 13px;
  color: var(--color-muted);
  text-align: center;
}
.error { color: #f07070; }

.day-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  border-top: 0.5px solid var(--color-border);
  cursor: pointer;
}
.day-row:hover .day-title { text-decoration: underline; }

.day-badge {
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
  margin-top: 2px;
}

/* Reuse group colour tints via badge- prefix */
.badge-airmission       { background: #1a2e4a; color: #5aa8f0; }
.badge-radiostation     { background: #2a1a3a; color: #c07af0; }
.badge-nniumission      { background: #1a3a2a; color: #5af0a0; }
.badge-seapatrol        { background: #1a3030; color: #5af0e0; }
.badge-commandoraid     { background: #3a1a1a; color: #f07070; }
.badge-sabotage         { background: #3a2a1a; color: #f0b05a; }

.day-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.day-title {
  font-size: 13px;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.day-log {
  font-size: 11px;
  color: var(--color-muted);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
