<template>
  <DetailPage
    :load="loadOrg"
    :reset="resetOrg"
    :not-found="!org"
    not-found-text="Organisasjon ikke funnet."
    page-class="org-detail"
  >
    <template v-if="org">
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

      <!-- Beskrivelse (stacked Descriptions, newest first) -->
      <details v-if="descriptions.length" class="section" open>
        <summary class="section-summary">
          <h3 class="section-heading">Beskrivelse<span v-if="descriptions.length > 1"> ({{ descriptions.length }})</span></h3>
        </summary>
        <div class="section-body">
          <article
            v-for="(d, i) in descriptions"
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

      <!-- Underavdelinger -->
      <details v-if="units.length" class="section" open>
        <summary class="section-summary"><h3 class="section-heading">Underavdelinger ({{ units.length }})</h3></summary>
        <div class="section-body">
          <div class="relation-list">
            <div v-for="u in units" :key="u.slug" class="relation-row">
              <RouterLink :to="`/district/${u.slug}`" class="relation-link">{{ u.name }}</RouterLink>
              <span v-if="u.role" class="relation-role">{{ ROLE_LABEL[u.role] ?? u.role }}</span>
              <button
                v-if="u.description"
                class="info-marker"
                type="button"
                :aria-expanded="expandedUnit === u.slug"
                aria-label="Vis forklaring"
                @click="toggleUnitInfo(u.slug)"
              >
                i
              </button>
              <div v-if="u.description && expandedUnit === u.slug" class="relation-desc">
                <p class="relation-desc-text">{{ u.description }}</p>
                <SourceRef v-if="u.sourceRefs?.length" :refs="u.sourceRefs" />
              </div>
            </div>
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

      <!-- Lenker — general external references (sibling concept to inline source citations) -->
      <details class="section" open>
        <summary class="section-summary">
          <h3 class="section-heading">Lenker<span v-if="externalRefs.length"> ({{ externalRefs.length }})</span></h3>
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
    </template>
  </DetailPage>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { RouterLink } from 'vue-router'
import { neo4jQuery } from '../composables/useNeo4j.ts'
import { blocksToHtml } from '../utils/portableText.ts'
import DetailPage from '../components/DetailPage.vue'
import ImageSlider, { type SlideImage } from '../components/ImageSlider.vue'
import SourceRef from '../components/SourceRef.vue'

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
  recordedDate: string | null
  author: string | null
  sourceRefs: string[] | null
}

interface ChildUnit {
  name: string
  slug: string
  role: string | null
  description: string | null
  sourceRefs: string[] | null
  order: number
}

const ROLE_LABEL: Record<string, string> = {
  administrative: 'administrativt',
  operational:    'operativt',
  sponsor:        'sponsor',
  parent:         'overordnet',
}

const org          = ref<OrgNode | null>(null)
const descriptions = ref<DescriptionNode[]>([])

const MIGRATION_AUTHORS = new Set([
  'sanity-outline-migration',
  'sanity-migration',
])
function showDescriptionAttribution(d: DescriptionNode): boolean {
  if (descriptions.value.length > 1) return true
  if (d.sourceRefs?.length) return true
  if (d.author && !MIGRATION_AUTHORS.has(d.author)) return true
  return false
}
const units        = ref<ChildUnit[]>([])
const expandedUnit = ref<string | null>(null)
function toggleUnitInfo(slug: string) {
  expandedUnit.value = expandedUnit.value === slug ? null : slug
}
const operations   = ref<{ name: string; slug: string }[]>([])
const events       = ref<{ slug: string; title: string; date: string | null }[]>([])
const people       = ref<{ slug: string; name: string; eventCount: number }[]>([])
const externalRefs = ref<{ id: string; title: string | null; url: string; type: string; domain: string | null; nbBacked: boolean }[]>([])
const galleryImages = ref<SlideImage[]>([])

function resetOrg() {
  org.value          = null
  descriptions.value = []
  units.value        = []
  operations.value   = []
  events.value       = []
  people.value       = []
  externalRefs.value = []
  galleryImages.value = []
  expandedUnit.value = null
}

async function loadOrg(slug: string) {
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
      // Descriptions — ALL entries ABOUT this org, stacked newest-first.
      // `sourceRefs` forward-compatible: no FROM Source edges exist today.
      neo4jQuery<{ content: string | null; recordedDate: string | null; author: string | null; sourceRefs: string[] }>(
        `MATCH (d:Description)-[:ABOUT]->(o:Organization {slug: $slug})
         OPTIONAL MATCH (d)-[:FROM]->(s:Source)
         WITH d, collect(s.id) AS sourceRefs
         RETURN d.content AS content,
                d.recordedDate AS recordedDate,
                d.author AS author,
                [x IN sourceRefs WHERE x IS NOT NULL] AS sourceRefs
         ORDER BY d.recordedDate DESC, d.id`,
        { slug },
      ),
      // Sub-units — PART_OF edges carry role/description/order per reporting
      // line (e.g. KP F is PART_OF SOE with role='operational'). The info
      // marker in the UI surfaces the description when set.
      //
      // Convention: edges with a description are "context info" / special
      // cases and sort last — primary members surface first, annotated ones
      // follow (e.g. KP F sinks below Kompani Linge on SOE's page).
      neo4jQuery<ChildUnit>(
        `MATCH (u:Unit)-[r:PART_OF]->(o:Organization {slug: $slug})
         RETURN u.canonicalName AS name,
                u.slug          AS slug,
                r.role          AS role,
                r.description   AS description,
                r.sourceRefs    AS sourceRefs,
                coalesce(r.order, 999) AS \`order\`
         ORDER BY CASE WHEN r.description IS NOT NULL THEN 1 ELSE 0 END,
                  \`order\`, name`,
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

    descriptions.value = descRows.flatMap(row => {
      if (!row.content) return []
      try {
        const blocks = JSON.parse(row.content) as unknown[]
        const html = blocksToHtml(blocks)
        if (!html) return []
        return [{
          html,
          recordedDate: row.recordedDate,
          author: row.author,
          sourceRefs: row.sourceRefs?.length ? row.sourceRefs : null,
        }]
      } catch { return [] }
    })
  } catch (err) {
    console.error('OrganizationDetail fetch error:', err)
    org.value = null
  }
}

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

.section-empty {
  margin: 0;
  padding: 4px 0;
  font-size: 12px;
  color: var(--color-muted);
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

.description-entry { margin: 0; }
.description-entry + .description-entry {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--color-border);
}

.description-attribution {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px dashed var(--color-border);
  font-size: 11px;
  color: var(--color-muted);
}
.description-author {
  font-weight: 600;
  color: var(--color-text);
}
.description-date { font-variant-numeric: tabular-nums; }

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

/* ── Relation rows (PART_OF with role/description edge metadata) ───── */
.relation-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.relation-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}

.relation-link {
  font-size: 13px;
  color: var(--color-navy);
  text-decoration: none;
}
.relation-link:hover { text-decoration: underline; }

.relation-role {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
  padding: 1px 6px;
  border: 1px solid var(--color-border-mid);
  border-radius: 3px;
}

.info-marker {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid var(--color-border-mid);
  background: var(--color-surface);
  color: var(--color-muted);
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
  background: var(--color-navy);
  border-color: var(--color-navy);
  color: #fff;
}

.relation-desc {
  flex-basis: 100%;
  margin: 4px 0 2px;
  padding: 8px 10px;
  background: var(--color-bg);
  border-left: 3px solid var(--color-navy);
  border-radius: 0 3px 3px 0;
}
.relation-desc-text {
  margin: 0 0 4px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-text);
}
.relation-desc-text:last-child { margin-bottom: 0; }

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
