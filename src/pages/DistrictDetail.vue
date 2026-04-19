<template>
  <DetailPage
    :load="loadUnit"
    :reset="resetUnit"
    :not-found="!unit"
    not-found-text="Avdeling ikke funnet."
    page-class="district-detail"
  >
    <template v-if="unit">
      <!-- Header -->
      <div class="page-header">
        <RouterLink to="/registre" class="back-link">&#x2039; Tilbake</RouterLink>
        <h1 class="unit-name">{{ unit.name }}</h1>
        <p v-if="unit.formalName" class="unit-meta">{{ unit.formalName }}</p>
        <p v-if="unit.foundedDate || unit.dissolvedDate || unit.country" class="unit-period">
          <span v-if="unit.foundedDate || unit.dissolvedDate">
            Etablert {{ unit.foundedDate ?? '?' }}<span v-if="unit.dissolvedDate"> – {{ unit.dissolvedDate }}</span>
          </span>
          <span v-if="unit.country" class="unit-country">{{ unit.country }}</span>
        </p>
        <div v-if="parents.length" class="parent-list">
          <div v-for="p in parents" :key="p.slug" class="parent-row">
            <RouterLink :to="parentRoute(p)" class="parent-link">
              <span v-if="p.color" class="color-dot" :style="{ background: p.color }"></span>
              {{ p.name }}
            </RouterLink>
            <span v-if="p.role" class="parent-role">{{ ROLE_LABEL[p.role] ?? p.role }}</span>
            <button
              v-if="p.description"
              class="info-marker"
              type="button"
              :aria-expanded="expandedParent === p.slug"
              aria-label="Vis forklaring"
              @click="toggleParentInfo(p.slug)"
            >
              i
            </button>
            <div v-if="p.description && expandedParent === p.slug" class="parent-desc">
              <p class="parent-desc-text">{{ p.description }}</p>
              <SourceRef v-if="p.sourceRefs?.length" :refs="p.sourceRefs" />
            </div>
          </div>
        </div>
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

      <!-- Underavdelinger (non-course sub-units) -->
      <details v-if="subUnits.length" class="section" open>
        <summary class="section-summary"><h3 class="section-heading">Underavdelinger ({{ subUnits.length }})</h3></summary>
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

      <!-- Kurs — training cohorts (Course-typed sub-units) -->
      <details v-if="courses.length" class="section" open>
        <summary class="section-summary"><h3 class="section-heading">Kurs ({{ courses.length }})</h3></summary>
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
                  <td>
                    <RouterLink :to="`/district/${c.slug}`" class="course-link">{{ c.letter }}</RouterLink>
                  </td>
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

      <!-- Galleri (direct + indirect via members and incidents) -->
      <details v-if="galleryImages.length" class="section" open>
        <summary class="section-summary"><h3 class="section-heading">Galleri ({{ galleryImages.length }})</h3></summary>
        <div class="section-body">
          <ImageSlider :images="galleryImages" />
        </div>
      </details>

      <!-- Medlemmer -->
      <details v-if="members.length" class="section" open>
        <summary class="section-summary"><h3 class="section-heading">Medlemmer ({{ members.length }})</h3></summary>
        <div class="section-body">
          <div class="relation-list">
            <div v-for="p in members" :key="p.slug" class="relation-row member-row">
              <RouterLink :to="`/person/${p.slug}`" class="person-name-link">{{ p.name }}</RouterLink>
              <span v-if="p.status === 'KIA'" class="status-marker status-marker--kia" title="Falt">✝</span>
              <span v-else-if="p.status === 'ambiguous'" class="status-marker status-marker--ambig" title="Uavklart skjebne">∞</span>
              <span v-if="p.rank" class="rank-badge">{{ p.rank }}</span>
              <span v-if="p.role" class="relation-role">{{ ROLE_LABEL[p.role] ?? p.role }}</span>
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
import DetailPage from '../components/DetailPage.vue'
import { neo4jQuery } from '../composables/useNeo4j.ts'
import { blocksToHtml } from '../utils/portableText.ts'
import ImageSlider, { type SlideImage } from '../components/ImageSlider.vue'
import SourceRef from '../components/SourceRef.vue'


interface UnitNode {
  name: string
  formalName: string | null
  type: string | null
  foundedDate: string | null
  dissolvedDate: string | null
  country: string | null
}

interface DescriptionNode {
  html: string
}

interface Parent {
  name: string
  slug: string
  label: 'Organization' | 'Unit'
  color: string | null
  role: string | null
  description: string | null
  sourceRefs: string[] | null
  order: number
}

const unit        = ref<UnitNode | null>(null)
const description = ref<DescriptionNode | null>(null)
const parents     = ref<Parent[]>([])
const expandedParent = ref<string | null>(null)
function toggleParentInfo(slug: string) {
  expandedParent.value = expandedParent.value === slug ? null : slug
}
function parentRoute(p: Parent): string {
  return p.label === 'Organization' ? `/organization/${p.slug}` : `/district/${p.slug}`
}
const ROLE_LABEL: Record<string, string> = {
  administrative: 'administrativt',
  operational:    'operativt',
  sponsor:        'sponsor',
  parent:         'overordnet',
}
const subUnits    = ref<{ name: string; slug: string }[]>([])
const courses     = ref<{ slug: string; letter: string; startDate: string | null; studentCount: number; missingCount: number; targetGroup: string | null }[]>([])
interface Member {
  slug: string
  name: string
  rank: string | null
  status: string | null
  role: string | null
  description: string | null
  sourceRefs: string[] | null
  startDate: string | null
  endDate: string | null
}
const members     = ref<Member[]>([])
const expandedMember = ref<string | null>(null)
function toggleMemberInfo(s: string) {
  expandedMember.value = expandedMember.value === s ? null : s
}
function memberPeriod(m: Member): string | null {
  if (!m.startDate && !m.endDate) return null
  return `${m.startDate ?? '?'}${m.endDate ? ` – ${m.endDate}` : ''}`
}
const events      = ref<{ slug: string; title: string; date: string | null }[]>([])
const externalRefs = ref<{ id: string; title: string | null; url: string; type: string; domain: string | null; nbBacked: boolean }[]>([])
const galleryImages = ref<SlideImage[]>([])

function resetUnit() {
  unit.value         = null
  description.value  = null
  parents.value      = []
  subUnits.value     = []
  courses.value      = []
  members.value      = []
  events.value       = []
  externalRefs.value = []
  galleryImages.value = []
  expandedParent.value = null
  expandedMember.value = null
}

async function loadUnit(slug: string) {
  try {
    const [unitRows, descRows, parentRows, subUnitRows, memberRows, eventRows, courseRows, refRows, galleryRows] = await Promise.all([
      neo4jQuery<UnitNode>(
        `MATCH (u:Unit {slug: $slug})
         RETURN u.canonicalName AS name,
                u.formalName    AS formalName,
                u.type          AS type,
                u.foundedDate   AS foundedDate,
                u.dissolvedDate AS dissolvedDate,
                u.country       AS country`,
        { slug },
      ),
      // Descriptions attached to this unit (from outline migration or editorial).
      neo4jQuery<{ content: string | null }>(
        `MATCH (d:Description)-[:ABOUT]->(u:Unit {slug: $slug})
         RETURN d.content AS content
         ORDER BY d.recordedDate DESC LIMIT 1`,
        { slug },
      ),
      // Parents — one PART_OF edge per reporting line (e.g. KP F admin→HOK,
      // operational→SOE). Edge props: role (chip), description (info marker),
      // order (render order among sibling parents).
      //
      // Convention: edges with a description are "context info" / special
      // cases and sort last — primary relationships surface first, annotated
      // ones follow.
      neo4jQuery<Parent>(
        `MATCH (u:Unit {slug: $slug})-[r:PART_OF]->(parent)
         WHERE parent:Organization OR parent:Unit
         RETURN parent.canonicalName AS name,
                parent.slug          AS slug,
                labels(parent)[0]    AS label,
                parent.color         AS color,
                r.role               AS role,
                r.description        AS description,
                r.sourceRefs         AS sourceRefs,
                coalesce(r.order, 999) AS \`order\`
         ORDER BY CASE WHEN r.description IS NOT NULL THEN 1 ELSE 0 END,
                  \`order\`, name`,
        { slug },
      ),
      // Sub-units — any Units PART_OF this one, EXCEPT training courses
      // (courses get their own table below).
      neo4jQuery<{ name: string; slug: string }>(
        `MATCH (child:Unit)-[:PART_OF]->(u:Unit {slug: $slug})
         WHERE child.type IS NULL OR child.type <> 'course'
         RETURN child.canonicalName AS name, child.slug AS slug
         ORDER BY name`,
        { slug },
      ),
      // Members — persons with MEMBER_OF edge (including nested sub-units), plus
      // their rank (skip the default Menig baseline), status marker (KIA etc.),
      // and edge metadata (role, description, sourceRefs, date range) from the
      // MEMBER_OF edge nearest the person (i.e. the direct membership, not the
      // target unit). Same info-marker pattern as PART_OF: edges with
      // description sort LAST within the person's row order.
      neo4jQuery<{ slug: string; name: string; rank: string | null; status: string | null; role: string | null; description: string | null; sourceRefs: string[] | null; startDate: string | null; endDate: string | null }>(
        `MATCH (p:Person)-[m:MEMBER_OF]->(:Unit)-[:PART_OF*0..]->(u:Unit {slug: $slug})
         OPTIONAL MATCH (p)-[:HELD_RANK]->(r:Rank)
         WHERE r.canonicalName <> 'Menig'
         WITH p, r, collect(m) AS edges
         WITH p, r,
              head([e IN edges WHERE e.description IS NOT NULL] + edges) AS m
         RETURN p.slug AS slug, p.canonicalName AS name,
                r.abbreviation AS rank, p.status AS status,
                m.role AS role, m.description AS description,
                m.sourceRefs AS sourceRefs,
                m.startDate AS startDate, m.endDate AS endDate
         ORDER BY CASE WHEN m.description IS NOT NULL THEN 1 ELSE 0 END,
                  name`,
        { slug },
      ),
      // Incidents this unit's members participated in.
      // Filtered by the unit's lifetime (foundedDate ≤ date ≤ dissolvedDate)
      // because MEMBER_OF doesn't track join/leave dates yet — without that
      // filter, Linge's page surfaces 1940-05 events from people who only
      // joined Linge after it was formed in 1940-08. Incidents with NULL
      // dates always pass through (we can't classify them).
      neo4jQuery<{ slug: string; title: string; date: string | null }>(
        `MATCH (u:Unit {slug: $slug})<-[:MEMBER_OF]-(p:Person)-[:INVOLVED_IN]->(i:Incident)
         WHERE i.date IS NULL
            OR (
              (u.foundedDate   IS NULL OR i.date >= u.foundedDate) AND
              (u.dissolvedDate IS NULL OR i.date <= u.dissolvedDate)
            )
         RETURN DISTINCT i.slug AS slug, i.title AS title, i.date AS date
         ORDER BY date`,
        { slug },
      ),
      // Training courses — Unit{type:"course"} sub-units with rich metadata.
      // Sort by the explicit `order` integer. Order was assigned at migration time
      // by (length of courseLetter, alphabetical) — scales to any naming scheme,
      // editable per-course if Jan wants to reposition one.
      neo4jQuery<{ slug: string; letter: string; startDate: string | null; studentCount: number; missingCount: number; targetGroup: string | null }>(
        `MATCH (c:Unit {type: 'course'})-[:PART_OF]->(u:Unit {slug: $slug})
         RETURN c.slug AS slug, c.courseLetter AS letter,
                c.startDate AS startDate, c.studentCount AS studentCount,
                c.missingCount AS missingCount, c.targetGroup AS targetGroup
         ORDER BY c.order`,
        { slug },
      ),
      // External references — Sources this Unit is REFERENCED_IN.
      // NB-backed (Nasjonalbiblioteket-operated) sources sort first, then by type.
      neo4jQuery<{ id: string; title: string | null; url: string; type: string; domain: string | null; nbBacked: boolean }>(
        `MATCH (u:Unit {slug: $slug})-[:REFERENCED_IN]->(s:Source)
         RETURN s.id AS id, s.title AS title, s.url AS url,
                s.type AS type, s.domain AS domain,
                coalesce(s.nbBacked, false) AS nbBacked
         ORDER BY nbBacked DESC, s.type, coalesce(s.title, s.url)`,
        { slug },
      ),
      // Gallery — photos reachable from this Unit by graph traversal, sorted
      // by bucket: 0 own, 1 operations, 2 parent org, 3 incidents, 4 people.
      //
      // HAS_IMAGE.scope = 'entity' pins an image to its attachment and is
      // filtered out of every propagating hop — direct unit photos (bucket 0)
      // are always shown because the unit IS the attachment entity.
      //
      // Incident-driven buckets (1, 3) filter by the unit's lifetime because
      // MEMBER_OF doesn't track join/leave dates — without it, e.g. Linge's
      // page would surface 1940-05 incidents from people who only joined
      // after the unit was formed in 1940-08. NULL dates always pass through.
      neo4jQuery<{ url: string; caption: string | null; subjectName: string; subjectSlug: string; subjectType: string; sortKey: number }>(
        `MATCH (unit:Unit {slug: $slug})
         CALL {
           WITH unit
           MATCH (unit)-[h:HAS_IMAGE]->(s:Source)
           RETURN s.url AS url, h.caption AS caption,
                  unit.canonicalName AS subjectName, unit.slug AS subjectSlug,
                  'unit' AS subjectType, 0 AS sortKey
           UNION
           WITH unit
           MATCH (unit)<-[:MEMBER_OF]-(:Person)-[:INVOLVED_IN]->(i:Incident)-[:PART_OF]->(op:Operation)-[h:HAS_IMAGE]->(s:Source)
           WHERE coalesce(h.scope, 'propagate') <> 'entity'
             AND (i.date IS NULL OR (
               (unit.foundedDate   IS NULL OR i.date >= unit.foundedDate) AND
               (unit.dissolvedDate IS NULL OR i.date <= unit.dissolvedDate)
             ))
           RETURN s.url AS url, h.caption AS caption,
                  op.codeName AS subjectName, op.slug AS subjectSlug,
                  'operation' AS subjectType, 1 AS sortKey
           UNION
           WITH unit
           MATCH (unit)-[:PART_OF*1..]->(o:Organization)-[h:HAS_IMAGE]->(s:Source)
           WHERE coalesce(h.scope, 'propagate') <> 'entity'
           RETURN s.url AS url, h.caption AS caption,
                  o.canonicalName AS subjectName, o.slug AS subjectSlug,
                  'organization' AS subjectType, 2 AS sortKey
           UNION
           WITH unit
           MATCH (unit)<-[:MEMBER_OF]-(:Person)-[:INVOLVED_IN]->(i:Incident)-[h:HAS_IMAGE]->(s:Source)
           WHERE coalesce(h.scope, 'propagate') <> 'entity'
             AND (i.date IS NULL OR (
               (unit.foundedDate   IS NULL OR i.date >= unit.foundedDate) AND
               (unit.dissolvedDate IS NULL OR i.date <= unit.dissolvedDate)
             ))
           RETURN s.url AS url, h.caption AS caption,
                  i.title AS subjectName, i.slug AS subjectSlug,
                  'incident' AS subjectType, 3 AS sortKey
           UNION
           WITH unit
           MATCH (unit)<-[:MEMBER_OF]-(p:Person)-[h:HAS_IMAGE]->(s:Source)
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

    unit.value         = unitRows[0] ?? null
    parents.value      = parentRows
    subUnits.value     = subUnitRows
    members.value      = memberRows
    events.value       = eventRows
    courses.value      = courseRows
    externalRefs.value = refRows
    // Dedupe by URL (same image can surface via multiple paths) and cast
    // subjectType to the SlideImage union.
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
    console.error('DistrictDetail fetch error:', err)
    unit.value = null
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

const courseTotals = computed(() => ({
  students: courses.value.reduce((sum, c) => sum + (c.studentCount ?? 0), 0),
  missing:  courses.value.reduce((sum, c) => sum + (c.missingCount ?? 0), 0),
}))
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

.unit-period {
  font-size: 12px;
  color: var(--color-muted);
  margin: 0 0 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-variant-numeric: tabular-nums;
}

.unit-country {
  display: inline-block;
  padding: 1px 6px;
  border: 1px solid var(--color-border-mid);
  border-radius: 3px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
}

.parent-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 4px;
}

.parent-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.parent-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-navy);
  text-decoration: none;
}
.parent-link:hover { text-decoration: underline; }

.parent-role {
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

.parent-desc {
  flex-basis: 100%;
  margin: 4px 0 2px;
  padding: 8px 10px;
  background: var(--color-bg);
  border-left: 3px solid var(--color-navy);
  border-radius: 0 3px 3px 0;
}
.parent-desc-text {
  margin: 0 0 4px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-text);
}
.parent-desc-text:last-child { margin-bottom: 0; }

.color-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
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
.member-row {
  padding: 4px 0;
}
.person-name-link {
  font-size: 13px;
  color: var(--color-navy);
  text-decoration: none;
}
.person-name-link:hover { text-decoration: underline; }

.member-period {
  font-size: 11px;
  color: var(--color-muted);
  font-variant-numeric: tabular-nums;
}

.person-item {
  display: flex;
  align-items: center;
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
  /* natural width — no flex-grow — so status marker sits right after the name */
}

.rank-badge {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-navy);
  background: var(--color-bg);
  border: 1px solid var(--color-border-mid);
  border-radius: 3px;
  padding: 2px 6px;
  white-space: nowrap;
  flex-shrink: 0;
  margin-left: auto;       /* pushes rank to the right edge */
}

.status-marker {
  font-size: 14px;
  flex-shrink: 0;
  line-height: 1;
}

.status-marker--kia   { color: var(--color-red); }
.status-marker--ambig { color: var(--color-muted); }

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

.person-count {
  font-size: 11px;
  color: var(--color-muted);
  white-space: nowrap;
  flex-shrink: 0;
}

.ext-icon { font-size: 11px; opacity: 0.6; }

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

/* ── Course table ───────────────────────────────────────────── */
.course-table-wrap {
  overflow-x: auto;
  margin-top: 10px;
}

.course-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.course-table th,
.course-table td {
  padding: 6px 10px;
  text-align: left;
  border-bottom: 1px solid var(--color-border);
  white-space: nowrap;
}

.course-table th {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-muted);
  background: var(--color-bg);
}

.course-table td.num,
.course-table th.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.course-link {
  display: inline-block;
  font-weight: 700;
  color: var(--color-navy);
  text-decoration: none;
  min-width: 26px;
}
.course-link:hover { text-decoration: underline; }

.course-date {
  color: var(--color-muted);
  font-variant-numeric: tabular-nums;
}

.course-group {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-muted);
}

.course-total td {
  font-weight: 700;
  border-top: 2px solid var(--color-border-mid);
  border-bottom: none;
  color: var(--color-text);
  background: var(--color-bg);
}
</style>
