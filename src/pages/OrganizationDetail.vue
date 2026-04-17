<template>
  <div class="org-detail">
    <div v-if="loading" class="status">Laster…</div>

    <div v-else-if="!org" class="status">Organisasjon ikke funnet.</div>

    <template v-else>
      <!-- Header -->
      <div class="page-header">
        <RouterLink to="/registre" class="back-link">&#x2039; Tilbake</RouterLink>
        <div class="org-title-row">
          <span v-if="org.color" class="color-dot" :style="{ background: org.color }"></span>
          <h1 class="org-name">{{ org.name }}</h1>
          <span v-if="org.abbreviation && org.abbreviation !== org.name" class="abbr-badge">{{ org.abbreviation }}</span>
        </div>
        <p v-if="org.formalName" class="org-meta">{{ org.formalName }}</p>
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

      <!-- Underavdelinger -->
      <section v-if="units.length" class="section">
        <h3 class="section-heading">Underavdelinger ({{ units.length }})</h3>
        <div class="link-list">
          <RouterLink
            v-for="u in units"
            :key="u.slug"
            :to="`/district/${u.slug}`"
            class="section-link"
          >
            {{ u.name }}
          </RouterLink>
        </div>
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

interface OrgNode {
  name: string
  formalName: string | null
  abbreviation: string | null
  sortingName: string | null
  color: string | null
}

interface TextNode {
  markdown: string
  source: string | null
  sourceUrl: string | null
}

const org         = ref<OrgNode | null>(null)
const description = ref<TextNode | null>(null)
const units       = ref<{ name: string; slug: string }[]>([])
const events      = ref<{ slug: string; title: string; date: string | null }[]>([])
const people      = ref<{ slug: string; name: string; eventCount: number }[]>([])

onMounted(async () => {
  const slug = route.params.slug as string
  try {
    const [orgRows, descRows, unitRows, eventRows, peopleRows] = await Promise.all([
      neo4jQuery<OrgNode>(
        `MATCH (o:Organization {slug: $slug})
         RETURN o.name AS name, o.formalName AS formalName, o.abbreviation AS abbreviation,
                o.sortingName AS sortingName, o.color AS color`,
        { slug },
      ),
      neo4jQuery<TextNode>(
        `MATCH (o:Organization {slug: $slug})-[:DESCRIBED_BY]->(t:Text)
         RETURN t.markdown AS markdown, t.source AS source, t.sourceUrl AS sourceUrl
         LIMIT 1`,
        { slug },
      ),
      neo4jQuery<{ name: string; slug: string }>(
        `MATCH (u:Unit)-[:PART_OF]->(o:Organization {slug: $slug})
         RETURN u.name AS name, u.slug AS slug
         ORDER BY u.name`,
        { slug },
      ),
      neo4jQuery<{ slug: string; title: string; date: string | null }>(
        `MATCH (e:Event)-[:ORGANISED_BY]->(o:Organization {slug: $slug})
         RETURN e.slug AS slug, e.title AS title, e.date AS date
         ORDER BY e.date`,
        { slug },
      ),
      neo4jQuery<{ slug: string; name: string; eventCount: number }>(
        `MATCH (o:Organization {slug: $slug})<-[:ORGANISED_BY]-(e:Event)-[:INVOLVED]->(p:Person)
         RETURN DISTINCT p.slug AS slug, p.name AS name, count(e) AS eventCount
         ORDER BY eventCount DESC`,
        { slug },
      ),
    ])

    org.value         = orgRows[0] ?? null
    description.value = descRows[0] ?? null
    units.value       = unitRows
    events.value      = eventRows
    people.value      = peopleRows
  } catch (err) {
    console.error('OrganizationDetail fetch error:', err)
    org.value = null
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
.org-detail {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: var(--color-bg);
  display: flex;
  flex-direction: column;
  align-items: center;
}

.org-detail > * {
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

.org-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.color-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  flex-shrink: 0;
}

.org-name {
  font-size: 22px;
  font-weight: 700;
  color: var(--color-text);
  margin: 0;
  line-height: 1.25;
  overflow-wrap: break-word;
}

.abbr-badge {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-navy);
  background: var(--color-bg);
  border: 1px solid var(--color-border-mid);
  border-radius: 3px;
  padding: 2px 7px;
  white-space: nowrap;
  flex-shrink: 0;
}

.org-meta {
  font-size: 13px;
  color: var(--color-muted);
  margin: 4px 0 0;
  font-style: italic;
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

.section-link {
  display: block;
  font-size: 13px;
  color: var(--color-navy);
  text-decoration: none;
  padding: 4px 0;
}
.section-link:hover { text-decoration: underline; }

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
