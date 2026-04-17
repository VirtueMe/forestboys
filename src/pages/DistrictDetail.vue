<template>
  <div class="district-detail">
    <div v-if="loading" class="status">Laster…</div>

    <div v-else-if="!unit" class="status">Avdeling ikke funnet.</div>

    <template v-else>
      <!-- Header -->
      <div class="page-header">
        <RouterLink to="/registre" class="back-link">&#x2039; Tilbake</RouterLink>
        <h1 class="unit-name">{{ unit.name }}</h1>
        <p v-if="unit.formalName" class="unit-meta">{{ unit.formalName }}</p>
        <RouterLink v-if="parentOrg" :to="`/organization/${parentOrg.slug}`" class="parent-link">
          <span v-if="parentOrg.color" class="color-dot" :style="{ background: parentOrg.color }"></span>
          {{ parentOrg.name }}
        </RouterLink>
      </div>

      <!-- Beskrivelse -->
      <section v-if="description" class="section">
        <h3 class="section-heading">Beskrivelse</h3>
        <blockquote v-if="description.source && description.source !== 'contributor'" class="quote-block">
          <p class="plain-text">{{ description.markdown }}</p>
          <cite v-if="description.sourceUrl" class="quote-source">
            <a :href="description.sourceUrl" target="_blank" rel="noopener noreferrer">
              {{ description.source }} <span class="ext-icon">↗</span>
            </a>
          </cite>
          <cite v-else class="quote-source">{{ description.source }}</cite>
        </blockquote>
        <p v-else class="plain-text">{{ description.markdown }}</p>
      </section>

      <!-- Hendelser -->
      <section v-if="events.length" class="section">
        <div class="section-header-row">
          <h3 class="section-heading">Hendelser ({{ events.length }})</h3>
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
          </RouterLink>
        </div>
      </section>

      <!-- Deltakere -->
      <section v-if="people.length" class="section">
        <h3 class="section-heading">Deltakere ({{ people.length }})</h3>
        <div class="link-list">
          <RouterLink
            v-for="p in people"
            :key="p.slug"
            :to="`/person/${p.slug}`"
            class="person-item"
          >
            <span class="person-name">{{ p.name }}</span>
            <span class="person-count">{{ p.eventCount }} hendelser</span>
          </RouterLink>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { neo4jQuery } from '../composables/useNeo4j.ts'

const route   = useRoute()
const loading = ref(true)

interface UnitNode {
  name: string
  formalName: string | null
  abbreviation: string | null
  sortingName: string | null
}

interface TextNode {
  markdown: string
  source: string | null
  sourceUrl: string | null
}

interface ParentOrg {
  name: string
  slug: string
  color: string | null
}

const unit        = ref<UnitNode | null>(null)
const description = ref<TextNode | null>(null)
const parentOrg   = ref<ParentOrg | null>(null)
const events      = ref<{ slug: string; title: string; date: string | null }[]>([])
const people      = ref<{ slug: string; name: string; eventCount: number }[]>([])

onMounted(async () => {
  const slug = route.params.slug as string
  try {
    const [unitRows, descRows, parentRows, eventRows, peopleRows] = await Promise.all([
      neo4jQuery<UnitNode>(
        `MATCH (u:Unit {slug: $slug})
         RETURN u.name AS name, u.formalName AS formalName, u.abbreviation AS abbreviation,
                u.sortingName AS sortingName`,
        { slug },
      ),
      neo4jQuery<TextNode>(
        `MATCH (u:Unit {slug: $slug})-[:DESCRIBED_BY]->(t:Text)
         RETURN t.markdown AS markdown, t.source AS source, t.sourceUrl AS sourceUrl
         LIMIT 1`,
        { slug },
      ),
      neo4jQuery<ParentOrg>(
        `MATCH (u:Unit {slug: $slug})-[:PART_OF]->(o:Organization)
         RETURN o.name AS name, o.slug AS slug, o.color AS color`,
        { slug },
      ),
      neo4jQuery<{ slug: string; title: string; date: string | null }>(
        `MATCH (e:Event)-[:PART_OF]->(u:Unit {slug: $slug})
         RETURN e.slug AS slug, e.title AS title, e.date AS date
         ORDER BY e.date`,
        { slug },
      ),
      neo4jQuery<{ slug: string; name: string; eventCount: number }>(
        `MATCH (u:Unit {slug: $slug})<-[:PART_OF]-(e:Event)-[:INVOLVED]->(p:Person)
         RETURN DISTINCT p.slug AS slug, p.name AS name, count(e) AS eventCount
         ORDER BY eventCount DESC`,
        { slug },
      ),
    ])

    unit.value        = unitRows[0] ?? null
    description.value = descRows[0] ?? null
    parentOrg.value   = parentRows[0] ?? null
    events.value      = eventRows
    people.value      = peopleRows
  } catch (err) {
    console.error('DistrictDetail fetch error:', err)
    unit.value = null
  } finally {
    loading.value = false
  }
})

const MONTHS = ['januar','februar','mars','april','mai','juni','juli','august','september','oktober','november','desember']

function formatDate(iso?: string | null): string {
  if (!iso) return '–'
  const [y, m, d] = iso.split('-').map(Number)
  return `${d}. ${MONTHS[m - 1]} ${y}`
}

const eventSortAsc = ref(true)

const sortedEvents = computed(() => {
  const evts = [...events.value]
  return eventSortAsc.value
    ? evts.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
    : evts.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
})
</script>

<style scoped>
.district-detail {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: var(--color-bg);
  display: flex;
  flex-direction: column;
  align-items: center;
}

.district-detail > * {
  width: 100%;
  max-width: 1320px;
}

.status {
  padding: 48px 20px;
  text-align: center;
  font-size: 13px;
  color: var(--color-muted);
}

/* ── Page header ────────────────────────────────────────────── */
.page-header {
  padding: 14px 16px 12px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.back-link {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-navy);
  text-decoration: none;
  margin-bottom: 6px;
}
.back-link:hover { text-decoration: underline; }

.unit-name {
  font-size: 22px;
  font-weight: 700;
  color: var(--color-text);
  margin: 0 0 4px;
  line-height: 1.25;
  overflow-wrap: break-word;
}

.unit-meta {
  font-size: 13px;
  color: var(--color-muted);
  margin: 0 0 6px;
  font-style: italic;
}

.parent-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-navy);
  text-decoration: none;
  margin-top: 4px;
}
.parent-link:hover { text-decoration: underline; }

.color-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* ── Sections ───────────────────────────────────────────────── */
.section {
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
}

.section + .section { border-top: none; }
.section:last-of-type { margin-bottom: 48px; }

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
  padding: 6px 10px;
  cursor: pointer;
  white-space: nowrap;
  touch-action: manipulation;
}
.sort-btn:hover { border-color: var(--color-navy); color: var(--color-navy); }

/* ── Description ────────────────────────────────────────────── */
.plain-text {
  font-size: 14px;
  line-height: 1.75;
  color: var(--color-text);
  margin: 0;
  white-space: pre-line;
}

.quote-block {
  border-left: 3px solid var(--color-border-mid);
  margin: 0;
  padding: 8px 0 8px 14px;
}

.quote-source {
  display: block;
  font-size: 11px;
  color: var(--color-muted);
  margin-top: 6px;
  font-style: normal;
}

.quote-source a {
  color: var(--color-navy);
  text-decoration: none;
}
.quote-source a:hover { text-decoration: underline; }

/* ── Link list ──────────────────────────────────────────────── */
.link-list { display: flex; flex-direction: column; gap: 2px; }

/* ── Event items ────────────────────────────────────────────── */
.event-item {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 6px 8px;
  margin: 0 -8px;
  text-decoration: none;
  color: var(--color-text);
  border-bottom: 1px solid var(--color-border);
  border-radius: 4px;
  transition: background 0.1s;
}
.event-item:last-child { border-bottom: none; }
.event-item:hover { background: var(--color-bg); }
.event-item:hover .event-title { text-decoration: underline; }

.event-date {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  flex-shrink: 0;
}

.event-title {
  font-size: 13px;
  color: var(--color-navy);
  flex: 1;
  min-width: 0;
}

/* ── Person items ───────────────────────────────────────────── */
.person-item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding: 4px 8px;
  margin: 0 -8px;
  text-decoration: none;
  border-radius: 4px;
  transition: background 0.1s;
}
.person-item:hover { background: var(--color-bg); }
.person-item:hover .person-name { text-decoration: underline; }

.person-name {
  font-size: 13px;
  color: var(--color-navy);
}

.person-count {
  font-size: 11px;
  color: var(--color-muted);
  white-space: nowrap;
  flex-shrink: 0;
}

.ext-icon { font-size: 11px; opacity: 0.6; }
</style>
