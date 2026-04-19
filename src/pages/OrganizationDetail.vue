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
        <p v-if="org.foundedDate || org.dissolvedDate || org.country" class="org-period">
          <span v-if="org.foundedDate || org.dissolvedDate">
            Etablert {{ org.foundedDate ?? '?' }}<span v-if="org.dissolvedDate"> – {{ org.dissolvedDate }}</span>
          </span>
          <span v-if="org.country" class="org-country">{{ org.country }}</span>
        </p>
      </div>

      <!-- Beskrivelse -->
      <details v-if="description" class="section" open>
        <summary class="section-summary"><h3 class="section-heading">Beskrivelse</h3></summary>
        <div class="section-body">
          <!-- eslint-disable vue/no-v-html -->
          <div class="portable-text" v-html="description.html"></div>
          <!-- eslint-enable vue/no-v-html -->
        </div>
      </details>

      <!-- Underavdelinger -->
      <details v-if="units.length" class="section" open>
        <summary class="section-summary"><h3 class="section-heading">Underavdelinger ({{ units.length }})</h3></summary>
        <div class="section-body">
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
        </div>
      </details>

      <!-- Operasjoner -->
      <details v-if="operations.length" class="section" open>
        <summary class="section-summary"><h3 class="section-heading">Operasjoner ({{ operations.length }})</h3></summary>
        <div class="section-body">
          <div class="link-list">
            <RouterLink
              v-for="op in operations"
              :key="op.slug"
              :to="`/operation/${op.slug}`"
              class="section-link"
            >
              {{ op.name }}
            </RouterLink>
          </div>
        </div>
      </details>

      <!-- Hendelser -->
      <details v-if="events.length" class="section" open>
        <summary class="section-summary"><h3 class="section-heading">Hendelser ({{ events.length }})</h3></summary>
        <div class="section-body">
          <div class="section-tools">
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
        </div>
      </details>

      <!-- Galleri (direct + indirect via member units and orchestrated incidents) -->
      <details v-if="galleryImages.length" class="section" open>
        <summary class="section-summary"><h3 class="section-heading">Galleri ({{ galleryImages.length }})</h3></summary>
        <div class="section-body">
          <ImageSlider :images="galleryImages" />
        </div>
      </details>

      <!-- Deltakere -->
      <details v-if="people.length" class="section" open>
        <summary class="section-summary"><h3 class="section-heading">Deltakere ({{ people.length }})</h3></summary>
        <div class="section-body">
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
        </div>
      </details>

      <!-- Eksterne referanser -->
      <details v-if="externalRefs.length" class="section" open>
        <summary class="section-summary"><h3 class="section-heading">Eksterne referanser ({{ externalRefs.length }})</h3></summary>
        <div class="section-body">
          <div class="link-list">
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
        </div>
      </details>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { neo4jQuery } from '../composables/useNeo4j.ts'
import { blocksToHtml } from '../utils/portableText.ts'
import ImageSlider, { type SlideImage } from '../components/ImageSlider.vue'

const route   = useRoute()
const loading = ref(true)

interface OrgNode {
  name: string
  formalName: string | null
  abbreviation: string | null
  sortingName: string | null
  color: string | null
  foundedDate: string | null
  dissolvedDate: string | null
  country: string | null
}

interface DescriptionNode {
  html: string
}

const org          = ref<OrgNode | null>(null)
const description  = ref<DescriptionNode | null>(null)
const units        = ref<{ name: string; slug: string }[]>([])
const operations   = ref<{ name: string; slug: string }[]>([])
const events       = ref<{ slug: string; title: string; date: string | null }[]>([])
const people       = ref<{ slug: string; name: string; eventCount: number }[]>([])
const externalRefs = ref<{ id: string; title: string | null; url: string; type: string; domain: string | null; nbBacked: boolean }[]>([])
const galleryImages = ref<SlideImage[]>([])

onMounted(async () => {
  const slug = route.params.slug as string
  try {
    const [orgRows, descRows, unitRows, opRows, eventRows, peopleRows, refRows, galleryRows] = await Promise.all([
      neo4jQuery<OrgNode>(
        `MATCH (o:Organization {slug: $slug})
         RETURN o.canonicalName AS name,
                o.formalName    AS formalName,
                o.abbreviation  AS abbreviation,
                o.sortingName   AS sortingName,
                o.color         AS color,
                o.foundedDate   AS foundedDate,
                o.dissolvedDate AS dissolvedDate,
                o.country       AS country`,
        { slug },
      ),
      // Descriptions attached to this org (Outline migrations + future editorial).
      neo4jQuery<{ content: string | null }>(
        `MATCH (d:Description)-[:ABOUT]->(o:Organization {slug: $slug})
         RETURN d.content AS content
         ORDER BY d.recordedDate DESC LIMIT 1`,
        { slug },
      ),
      neo4jQuery<{ name: string; slug: string }>(
        `MATCH (u:Unit)-[:PART_OF]->(o:Organization {slug: $slug})
         RETURN u.canonicalName AS name, u.slug AS slug
         ORDER BY name`,
        { slug },
      ),
      // Operations orchestrated by this org (round-2 classified outlines).
      neo4jQuery<{ name: string; slug: string }>(
        `MATCH (op:Operation)-[:ORCHESTRATED_BY]->(o:Organization {slug: $slug})
         RETURN op.codeName AS name, op.slug AS slug
         ORDER BY name`,
        { slug },
      ),
      // Incidents orchestrated by this org (round-3 pending — empty for now).
      neo4jQuery<{ slug: string; title: string; date: string | null }>(
        `MATCH (i:Incident)-[:ORCHESTRATED_BY]->(o:Organization {slug: $slug})
         RETURN i.slug AS slug, i.title AS title, i.date AS date
         ORDER BY i.date`,
        { slug },
      ),
      // Participants reached via Incidents (empty until round 3).
      neo4jQuery<{ slug: string; name: string; eventCount: number }>(
        `MATCH (o:Organization {slug: $slug})<-[:ORCHESTRATED_BY]-(i:Incident)<-[:INVOLVED_IN]-(p:Person)
         RETURN DISTINCT p.slug AS slug, p.canonicalName AS name, count(i) AS eventCount
         ORDER BY eventCount DESC`,
        { slug },
      ),
      // External references — Sources this Organization is REFERENCED_IN.
      neo4jQuery<{ id: string; title: string | null; url: string; type: string; domain: string | null; nbBacked: boolean }>(
        `MATCH (o:Organization {slug: $slug})-[:REFERENCED_IN]->(s:Source)
         RETURN s.id AS id, s.title AS title, s.url AS url,
                s.type AS type, s.domain AS domain,
                coalesce(s.nbBacked, false) AS nbBacked
         ORDER BY nbBacked DESC, s.type, coalesce(s.title, s.url)`,
        { slug },
      ),
      // Gallery — photos reachable from this Org by graph traversal, sorted
      // by bucket: 0 own, 1 operations, 2 units, 3 incidents, 4 people.
      // HAS_IMAGE.scope = 'entity' pins a Source to its attachment and is
      // filtered out of every propagating hop. Today only Incident/Person have
      // HAS_IMAGE edges in the DB; upper buckets are forward-compatible.
      neo4jQuery<{ url: string; caption: string | null; subjectName: string; subjectSlug: string; subjectType: string; sortKey: number }>(
        `CALL {
           MATCH (o:Organization {slug: $slug})-[h:HAS_IMAGE]->(s:Source)
           RETURN s.url AS url, h.caption AS caption,
                  o.canonicalName AS subjectName, o.slug AS subjectSlug,
                  'organization' AS subjectType, 0 AS sortKey
           UNION
           MATCH (o:Organization {slug: $slug})<-[:ORCHESTRATED_BY]-(op:Operation)-[h:HAS_IMAGE]->(s:Source)
           WHERE coalesce(h.scope, 'propagate') <> 'entity'
           RETURN s.url AS url, h.caption AS caption,
                  op.codeName AS subjectName, op.slug AS subjectSlug,
                  'operation' AS subjectType, 1 AS sortKey
           UNION
           MATCH (o:Organization {slug: $slug})<-[:PART_OF*1..]-(u:Unit)-[h:HAS_IMAGE]->(s:Source)
           WHERE coalesce(h.scope, 'propagate') <> 'entity'
           RETURN s.url AS url, h.caption AS caption,
                  u.canonicalName AS subjectName, u.slug AS subjectSlug,
                  'unit' AS subjectType, 2 AS sortKey
           UNION
           MATCH (o:Organization {slug: $slug})<-[:ORCHESTRATED_BY]-(i:Incident)-[h:HAS_IMAGE]->(s:Source)
           WHERE coalesce(h.scope, 'propagate') <> 'entity'
           RETURN s.url AS url, h.caption AS caption,
                  i.title AS subjectName, i.slug AS subjectSlug,
                  'incident' AS subjectType, 3 AS sortKey
           UNION
           MATCH (o:Organization {slug: $slug})<-[:PART_OF*1..]-(:Unit)<-[:MEMBER_OF]-(p:Person)-[h:HAS_IMAGE]->(s:Source)
           WHERE coalesce(h.scope, 'propagate') <> 'entity'
           RETURN s.url AS url, h.caption AS caption,
                  p.canonicalName AS subjectName, p.slug AS subjectSlug,
                  'person' AS subjectType, 4 AS sortKey
         }
         RETURN url, caption, subjectName, subjectSlug, subjectType, sortKey
         ORDER BY sortKey, subjectName
         LIMIT 200`,
        { slug },
      ),
    ])

    org.value          = orgRows[0] ?? null
    operations.value   = opRows
    units.value        = unitRows
    events.value       = eventRows
    people.value       = peopleRows
    externalRefs.value = refRows
    // Dedupe by URL (same Source can surface via multiple traversals).
    const seen = new Set<string>()
    galleryImages.value = galleryRows
      .filter(r => !seen.has(r.url) && seen.add(r.url))
      .map(r => ({
        url: r.url,
        caption: r.caption,
        subjectName: r.subjectName,
        subjectSlug: r.subjectSlug,
        subjectType: r.subjectType as SlideImage['subjectType'],
      }))

    const descRow = descRows[0]
    if (descRow?.content) {
      try {
        const blocks = JSON.parse(descRow.content) as unknown[]
        const html = blocksToHtml(blocks)
        description.value = html ? { html } : null
      } catch { description.value = null }
    }
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

.org-period {
  font-size: 12px;
  color: var(--color-muted);
  margin: 6px 0 0;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-variant-numeric: tabular-nums;
}

.org-country {
  display: inline-block;
  padding: 1px 6px;
  border: 1px solid var(--color-border-mid);
  border-radius: 3px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
}

/* ── Sections (collapsible via native <details>) ────────────── */
.section {
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
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
  color: var(--color-muted);
  transition: transform 0.15s ease;
  flex-shrink: 0;
}
.section:not([open]) > .section-summary::after {
  transform: rotate(-90deg);
}
.section-summary:hover { background: var(--color-bg); }

.section-body {
  padding: 0 16px 12px;
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

/* ── Portable text (Description rendering) ──────────────────── */
.portable-text { margin-top: 4px; }

.portable-text :deep(p) {
  margin: 0 0 0.75em;
  font-size: 14px;
  line-height: 1.65;
  color: var(--color-text);
}
.portable-text :deep(p:last-child) { margin-bottom: 0; }

.portable-text :deep(ul),
.portable-text :deep(ol) {
  margin: 0.5em 0 0.75em;
  padding-left: 1.5em;
}
.portable-text :deep(li) {
  margin: 0.25em 0;
  font-size: 14px;
  line-height: 1.65;
  color: var(--color-text);
}

.portable-text :deep(h1),
.portable-text :deep(h2),
.portable-text :deep(h3),
.portable-text :deep(h4) {
  font-size: 14px;
  font-weight: 700;
  margin: 1em 0 0.4em;
  color: var(--color-navy);
}

.portable-text :deep(strong) { font-weight: 600; }
.portable-text :deep(em)     { font-style: italic; }
.portable-text :deep(a) {
  color: var(--color-navy);
  text-decoration: underline;
  cursor: pointer;
}

/* ── Description (legacy plain-text quote) ──────────────────── */
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

/* ── External reference rows ─────────────────────────────────── */
.ref-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  margin: 0 -8px;
  text-decoration: none;
  color: var(--color-text);
  border-radius: 4px;
  transition: background 0.1s;
}
.ref-item:hover { background: var(--color-bg); }
.ref-item:hover .ref-title { text-decoration: underline; }

.ref-title {
  font-size: 13px;
  color: var(--color-navy);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ref-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

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

.ref-domain {
  font-size: 11px;
  color: var(--color-muted);
  font-variant-numeric: tabular-nums;
}
</style>
