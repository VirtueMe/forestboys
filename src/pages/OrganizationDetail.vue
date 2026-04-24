<template>
  <DetailPage
    :load="loadOrg"
    :reset="resetOrg"
    :not-found="!org"
    not-found-text="Organisasjon ikke funnet."
    page-class="org-detail"
  >
    <template v-if="org">
      <AdminViewTabs v-model="mode" />

      <!-- Header -->
      <div class="page-header">
        <RouterLink to="/registre" class="back-link">&#x2039; Tilbake</RouterLink>
        <div class="org-title-row">
          <span v-if="displayColor" class="color-dot" :style="{ background: displayColor }"></span>
          <h1 class="org-name">{{ displayName }}</h1>
          <span v-if="displayAbbreviation && displayAbbreviation !== displayName" class="abbr-badge">{{ displayAbbreviation }}</span>
        </div>
        <p v-if="displayFormalName" class="org-meta">{{ displayFormalName }}</p>
        <p v-if="displayFoundedDate || displayDissolvedDate || displayCountry" class="org-period">
          <span v-if="displayFoundedDate || displayDissolvedDate">
            Etablert {{ displayFoundedDate || '?' }}<span v-if="displayDissolvedDate"> – {{ displayDissolvedDate }}</span>
          </span>
          <span v-if="displayCountry" class="org-country">{{ displayCountry }}</span>
        </p>
      </div>

      <!-- Admin: organization scalar editor -->
      <div v-if="mode === 'edit'" class="edit-pane">
      <section class="edit-section">
        <h3 class="edit-section-heading">Organisasjon</h3>
        <div class="edit-row">
          <label class="edit-label" for="edit-name">Navn</label>
          <input id="edit-name" v-model="editForm.name" class="edit-input" type="text" />
        </div>
        <div class="edit-row">
          <label class="edit-label" for="edit-formalName">Formelt navn</label>
          <input id="edit-formalName" v-model="editForm.formalName" class="edit-input" type="text" />
        </div>
        <div class="edit-row">
          <label class="edit-label" for="edit-abbreviation">Forkortelse</label>
          <input id="edit-abbreviation" v-model="editForm.abbreviation" class="edit-input" type="text" />
        </div>
        <div class="edit-row">
          <label class="edit-label" for="edit-sortingName">Sorteringsnavn</label>
          <input id="edit-sortingName" v-model="editForm.sortingName" class="edit-input" type="text" />
        </div>
        <div class="edit-row">
          <label class="edit-label" for="edit-color">Farge</label>
          <div class="edit-color-row">
            <input id="edit-color" v-model="editForm.color" class="edit-input edit-input-color-text" type="text" placeholder="#aabbcc" />
            <span v-if="editForm.color" class="edit-color-swatch" :style="{ background: editForm.color }"></span>
          </div>
        </div>
        <div class="edit-row">
          <label class="edit-label" for="edit-country">Land</label>
          <input id="edit-country" v-model="editForm.country" class="edit-input" type="text" />
        </div>
        <div class="edit-row">
          <label class="edit-label" for="edit-foundedDate">Etablert</label>
          <input id="edit-foundedDate" v-model="editForm.foundedDate" class="edit-input edit-input-date" type="text" placeholder="YYYY-MM-DD" />
        </div>
        <div class="edit-row">
          <label class="edit-label" for="edit-dissolvedDate">Oppløst</label>
          <input id="edit-dissolvedDate" v-model="editForm.dissolvedDate" class="edit-input edit-input-date" type="text" placeholder="YYYY-MM-DD" />
        </div>
        <footer v-if="editDirty" class="edit-save-bar">
          <span class="edit-save-prompt">Ser det bra ut?</span>
          <button type="button" class="edit-btn-primary" :disabled="editSaving" @click="saveEdit">
            {{ editSaving ? 'Lagrer…' : 'Lagre' }}
          </button>
          <button type="button" class="edit-link-revert" :disabled="editSaving" @click="revertEdit">Angre</button>
        </footer>
        <div v-if="editError" class="edit-save-error">{{ editError }}</div>
      </section>

      <DescriptionEditor
        ref="descEditor"
        :saved="savedSections"
        :endpoint="`/api/admin/organization/${encodeURIComponent(orgSlug)}/sections`"
        @saved="sections => savedSections = sections"
      />

      <RelationListEditor
        :parent-slug="orgSlug"
        :entries="unitEntries"
        :targets="unitTargets"
        :strategy="OrganizationUnitsStrategy"
        label="Underavdelinger"
        add-label="+ Legg til underavdeling"
        empty-label="Ingen underavdelinger"
        search-placeholder="Søk avdeling…"
        picker-chip-aria="Bytt avdeling"
        validation-empty="Velg avdeling for alle rader før du lagrer."
        show-role
        :role-options="PART_OF_ROLE_LABEL"
        :show-dates="false"
        :signature-extra="unitEntrySignatureExtra"
        :summary-extra="unitSummaryExtra"
      >
        <template #extra-fields="{ entry }">
          <div class="unit-edge-row">
            <label class="unit-edge-label">Rekkefølge</label>
            <input
              class="edit-input edit-input-order"
              type="number"
              min="0"
              inputmode="numeric"
              :value="entry.order ?? ''"
              @input="entry.order = ($event.target as HTMLInputElement).value === '' ? null : Number(($event.target as HTMLInputElement).value)"
            />
          </div>
        </template>
      </RelationListEditor>
      </div>

      <!-- Beskrivelse (HAS_CONTENT sections rendered with citations + Kilder) -->
      <details v-if="mode !== 'edit' && previewSections.length" class="section" open>
        <summary class="section-summary">
          <h3 class="section-heading">Beskrivelse</h3>
        </summary>
        <div class="section-body">
          <DescriptionPreview :sections="previewSections" />
        </div>
      </details>

      <!-- Underavdelinger (PART_OF edges) -->
      <details v-if="mode !== 'edit' && unitEntries.length" class="section" open>
        <summary class="section-summary"><h3 class="section-heading">Underavdelinger ({{ unitEntries.length }})</h3></summary>
        <div class="section-body">
          <div class="relation-list">
            <div v-for="u in unitEntries" :key="u.targetSlug" class="relation-row">
              <RouterLink :to="`/district/${u.targetSlug}`" class="relation-link">{{ u.targetName }}</RouterLink>
              <span v-if="u.role" class="relation-role">{{ PART_OF_ROLE_LABEL[u.role] ?? u.role }}</span>
              <button
                v-if="u.hasDescription"
                class="info-marker"
                type="button"
                aria-label="Vis forklaring"
                @click="activeUnit = u"
              >
                i
              </button>
            </div>
          </div>
        </div>
      </details>

      <RelationInfoPopup
        :entry="activeUnit"
        :role-options="PART_OF_ROLE_LABEL"
        show-role
        @close="activeUnit = null"
      />

      <!-- Operasjoner -->
      <details v-if="operations.length" class="section" open>
        <summary class="section-summary"><h3 class="section-heading">Operasjoner ({{ operations.length }})</h3></summary>
        <div class="section-body">
          <div class="link-list">
            <RouterLink
              v-for="op in operations"
              :key="op.slug"
              :to="`/events/${op.slug}`"
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
import { ref, computed, useTemplateRef } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { neo4jQuery } from '../composables/useNeo4j.ts'
import { authFetch } from '../composables/useAuth.ts'
import DetailPage from '../components/DetailPage.vue'
import ImageSlider, { type SlideImage } from '../components/ImageSlider.vue'
import AdminViewTabs, { type AdminViewMode } from '../components/AdminViewTabs.vue'
import { type Section }   from '../components/SectionsEditor.vue'
import DescriptionPreview from '../components/DescriptionPreview.vue'
import DescriptionEditor  from '../components/DescriptionEditor.vue'
import RelationListEditor from '../components/relation/RelationListEditor.vue'
import RelationInfoPopup  from '../components/relation/RelationInfoPopup.vue'
import { OrganizationUnitsStrategy, PART_OF_ROLE_LABEL } from '../components/relation/strategies.ts'
import type { RelationEntry, RelationTarget } from '../components/relation/RelationStrategy.ts'

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

interface SectionRow {
  order:   number | null
  content: string | null
  citations: Array<{
    inline:       boolean | null
    sourceId:     string | null
    sourceTitle:  string | null
    sourceUrl:    string | null
    sourceAuthor: string | null
  }>
  sourcedFrom: {
    id:             string
    title:          string | null
    url:            string | null
    authorFreeText: string | null
    license:        string | null
    attribution:    string | null
  } | null
}

const route        = useRoute()
const orgSlug      = computed(() => String(route.params.slug))
const mode         = ref<AdminViewMode>('preview')

const org          = ref<OrgNode | null>(null)

const savedSections = ref<Section[]>([])
const descEditor = useTemplateRef<{ draft: Section[]; dirty: boolean } | null>('descEditor')

const unitEntries  = ref<RelationEntry[]>([])
const unitTargets  = ref<RelationTarget[]>([])
const activeUnit   = ref<RelationEntry | null>(null)

function unitEntrySignatureExtra(e: RelationEntry): string {
  return `${e.order ?? ''}`
}
function unitSummaryExtra(e: RelationEntry): string {
  return typeof e.order === 'number' ? `#${e.order}` : ''
}

const operations   = ref<{ name: string; slug: string }[]>([])
const events       = ref<{ slug: string; title: string; date: string | null }[]>([])
const people       = ref<{ slug: string; name: string; eventCount: number }[]>([])
const externalRefs = ref<{ id: string; title: string | null; url: string; type: string; domain: string | null; nbBacked: boolean }[]>([])
const galleryImages = ref<SlideImage[]>([])

interface EditForm {
  name:          string
  formalName:    string
  abbreviation:  string
  sortingName:   string
  color:         string
  country:       string
  foundedDate:   string
  dissolvedDate: string
}
const EMPTY_EDIT: EditForm = {
  name: '', formalName: '', abbreviation: '', sortingName: '',
  color: '', country: '', foundedDate: '', dissolvedDate: '',
}
const editForm     = ref<EditForm>({ ...EMPTY_EDIT })
const editOriginal = ref<EditForm>({ ...EMPTY_EDIT })
const editSaving   = ref(false)
const editError    = ref<string | null>(null)
const editDirty    = computed(() =>
  (Object.keys(EMPTY_EDIT) as (keyof EditForm)[])
    .some(k => editForm.value[k] !== editOriginal.value[k]),
)

function resetOrg() {
  org.value          = null
  savedSections.value   = []
  unitEntries.value  = []
  unitTargets.value  = []
  activeUnit.value   = null
  operations.value   = []
  events.value       = []
  people.value       = []
  externalRefs.value = []
  galleryImages.value = []
  editForm.value     = { ...EMPTY_EDIT }
  editOriginal.value = { ...EMPTY_EDIT }
  editError.value    = null
}

function hydrateEditForm(o: OrgNode) {
  const f: EditForm = {
    name:          o.name ?? '',
    formalName:    o.formalName ?? '',
    abbreviation:  o.abbreviation ?? '',
    sortingName:   o.sortingName ?? '',
    color:         o.color ?? '',
    country:       o.country ?? '',
    foundedDate:   o.foundedDate ?? '',
    dissolvedDate: o.dissolvedDate ?? '',
  }
  editForm.value     = { ...f }
  editOriginal.value = { ...f }
  editError.value    = null
}

function revertEdit() {
  editForm.value  = { ...editOriginal.value }
  editError.value = null
}

async function saveEdit() {
  const slug = String(route.params.slug)
  if (!slug) return
  const body: Record<string, unknown> = {}
  const f = editForm.value, o = editOriginal.value
  if (f.name          !== o.name)          body.name          = f.name.trim()
  if (f.formalName    !== o.formalName)    body.formalName    = f.formalName.trim()    || null
  if (f.abbreviation  !== o.abbreviation)  body.abbreviation  = f.abbreviation.trim()  || null
  if (f.sortingName   !== o.sortingName)   body.sortingName   = f.sortingName.trim()   || null
  if (f.color         !== o.color)         body.color         = f.color.trim()         || null
  if (f.country       !== o.country)       body.country       = f.country.trim()       || null
  if (f.foundedDate   !== o.foundedDate)   body.foundedDate   = f.foundedDate.trim()   || null
  if (f.dissolvedDate !== o.dissolvedDate) body.dissolvedDate = f.dissolvedDate.trim() || null
  if (!Object.keys(body).length) return

  editSaving.value = true
  editError.value  = null
  try {
    const res = await authFetch(`/api/admin/organization/${encodeURIComponent(slug)}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    const out = await res.json().catch(() => ({})) as Partial<OrgNode> & { error?: string }
    if (!res.ok) {
      editError.value = out.error ?? `HTTP ${res.status}`
      return
    }
    if (org.value && out.name !== undefined) {
      org.value = {
        name:          out.name ?? '',
        formalName:    out.formalName    ?? null,
        abbreviation:  out.abbreviation  ?? null,
        sortingName:   out.sortingName   ?? null,
        color:         out.color         ?? null,
        country:       out.country       ?? null,
        foundedDate:   out.foundedDate   ?? null,
        dissolvedDate: out.dissolvedDate ?? null,
      }
      hydrateEditForm(org.value)
    }
  } catch (e) {
    editError.value = (e as Error).message
  } finally {
    editSaving.value = false
  }
}

async function loadOrg(slug: string) {
  try {
    const [orgRows, sectionRows, fetchedUnitEntries, fetchedUnitTargets, opRows, eventRows, peopleRows, refRows, galleryRows] = await Promise.all([
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
      // Descriptions — HAS_CONTENT sections on this Organization, same shape
      // as Person's sections (order, content, CITES, SOURCED_FROM).
      neo4jQuery<SectionRow>(
        `MATCH (o:Organization {slug: $slug})-[:HAS_CONTENT]->(d:Description)
         OPTIONAL MATCH (d)-[:SOURCED_FROM]->(from:Source)
         WITH d, from
         OPTIONAL MATCH (d)-[cites:CITES]->(src:Source)
         WITH d, from,
              collect(CASE WHEN src IS NULL THEN NULL ELSE {
                inline:       coalesce(cites.inline, false),
                sourceId:     src.id,
                sourceTitle:  src.title,
                sourceUrl:    src.url,
                sourceAuthor: src.authorFreeText
              } END) AS rawCites
         RETURN coalesce(d.order, 1) AS \`order\`,
                d.content AS content,
                [x IN rawCites WHERE x IS NOT NULL] AS citations,
                CASE WHEN from IS NULL THEN NULL ELSE {
                  id:             from.id,
                  title:          from.title,
                  url:             from.url,
                  authorFreeText: from.authorFreeText,
                  license:        from.license,
                  attribution:    from.attribution
                } END AS sourcedFrom
         ORDER BY \`order\``,
        { slug },
      ),
      // Sub-units — PART_OF edges carry role/description/order. Convention:
      // edges with a description are "context info" / special cases and sort
      // last (e.g. KP F sinks below Kompani Linge on SOE's page).
      OrganizationUnitsStrategy.fetchEntries(slug),
      OrganizationUnitsStrategy.fetchTargets(),
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
    if (org.value) hydrateEditForm(org.value)
    operations.value   = opRows
    unitEntries.value  = fetchedUnitEntries
    unitTargets.value  = fetchedUnitTargets
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

    savedSections.value = sectionRows.map(rowToSection)
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

/** Live preview — draft values overlay the page header while dirty. */
const displayName          = computed(() => editDirty.value ? editForm.value.name          : (org.value?.name ?? ''))
const displayFormalName    = computed(() => editDirty.value ? editForm.value.formalName    : (org.value?.formalName ?? ''))
const displayAbbreviation  = computed(() => editDirty.value ? editForm.value.abbreviation  : (org.value?.abbreviation ?? ''))
const displayColor         = computed(() => editDirty.value ? editForm.value.color         : (org.value?.color ?? ''))
const displayCountry       = computed(() => editDirty.value ? editForm.value.country       : (org.value?.country ?? ''))
const displayFoundedDate   = computed(() => editDirty.value ? editForm.value.foundedDate   : (org.value?.foundedDate ?? ''))
const displayDissolvedDate = computed(() => editDirty.value ? editForm.value.dissolvedDate : (org.value?.dissolvedDate ?? ''))

// ── Beskrivelse sections (HAS_CONTENT → Description) ───────────────
function rowToSection(r: SectionRow): Section {
  return {
    order:   r.order ?? 1,
    content: r.content ?? '[]',
    citations: (r.citations ?? [])
      .filter(c => c.sourceId)
      .map(c => ({
        inline: c.inline ?? false,
        source: {
          id:             c.sourceId!,
          title:          c.sourceTitle,
          url:            c.sourceUrl,
          authorFreeText: c.sourceAuthor,
        },
      })),
    sourcedFrom: r.sourcedFrom ? { ...r.sourcedFrom } : null,
  }
}

/** Sections to render in the Beskrivelse preview — overlays the editor's
 *  unsaved draft when dirty so the user sees changes live. */
const previewSections = computed<Section[]>(() =>
  descEditor.value?.dirty ? descEditor.value.draft : savedSections.value,
)

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
  padding: var(--space-md);
  background: var(--paper-raised);
  border-bottom: 1px solid var(--rule);
}

.back-link {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  font-family: var(--font-sans);
  font-size: var(--size-label);
  font-weight: 500;
  color: var(--ink-soft);
  text-decoration: underline;
  text-decoration-color: var(--rule);
  text-underline-offset: 3px;
  margin-bottom: var(--space-sm);
}
.back-link:hover { color: var(--faded-red); text-decoration-color: var(--faded-red); }

.org-title-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-wrap: wrap;
}

.color-dot {
  width: 14px;
  height: 14px;
  border-radius: var(--radius-pill);
  flex-shrink: 0;
}

.org-name {
  font-family: var(--font-serif);
  font-size: var(--size-display);
  font-weight: 600;
  color: var(--ink);
  margin: 0;
  line-height: var(--leading-tight);
  letter-spacing: var(--tracking-tight);
  overflow-wrap: break-word;
}

.abbr-badge {
  display: inline-block;
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: var(--tracking-caps);
  color: var(--ink-soft);
  background: var(--paper-sunken);
  border-radius: var(--radius-pill);
  padding: var(--space-xs) var(--space-sm);
  white-space: nowrap;
  flex-shrink: 0;
}

.org-meta {
  font-family: var(--font-serif);
  font-size: var(--size-body);
  color: var(--ink-soft);
  margin: var(--space-xs) 0 0;
  font-style: italic;
}

.org-period {
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--muted);
  margin: var(--space-sm) 0 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-md);
  font-variant-numeric: tabular-nums;
}

.org-country {
  display: inline-block;
  padding: var(--space-xs) var(--space-sm);
  background: var(--paper-sunken);
  border-radius: var(--radius-pill);
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--ink-soft);
}

/* ── Admin: scalar editor ───────────────────────────────────── */
.edit-section {
  padding: var(--space-md);
  background: var(--paper-raised);
  border-bottom: 1px solid var(--rule);
}
.edit-section-heading {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--muted);
  margin: 0 0 var(--space-md);
}
.edit-row {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: var(--space-md);
  align-items: center;
  margin-bottom: var(--space-sm);
}
.edit-label {
  font-family: var(--font-sans);
  font-size: var(--size-label);
  font-weight: 500;
  color: var(--ink-soft);
}
.edit-input {
  width: 100%;
  padding: var(--space-sm) var(--space-md);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink);
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  box-sizing: border-box;
}
.edit-input:focus {
  outline: 1px solid var(--focus);
  outline-offset: 0;
  border-color: var(--focus);
}
.edit-input-date { font-family: var(--font-mono); font-size: var(--size-mono); max-width: 160px; }
.edit-color-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.edit-input-color-text { font-family: var(--font-mono); font-size: var(--size-mono); max-width: 140px; }
.edit-color-swatch {
  width: 24px;
  height: 24px;
  border-radius: var(--radius-md);
  border: 1px solid var(--rule);
  flex-shrink: 0;
}
.edit-save-bar {
  margin-top: var(--space-md);
  padding: var(--space-md);
  background: var(--paper-sunken);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  gap: var(--space-md);
}
.edit-save-prompt {
  flex: 1;
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink-soft);
  font-weight: 500;
}
.edit-btn-primary {
  padding: var(--space-sm) var(--space-lg);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  font-weight: 500;
  background: var(--faded-red);
  color: var(--paper);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
}
.edit-btn-primary:hover:not(:disabled) { background: var(--faded-red-soft); }
.edit-btn-primary:disabled { background: var(--paper); color: var(--muted); cursor: not-allowed; }
.edit-link-revert {
  background: transparent;
  border: none;
  padding: 0;
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--ink-soft);
  text-decoration: underline;
  text-decoration-color: var(--rule);
  text-underline-offset: 3px;
  cursor: pointer;
}
.edit-link-revert:hover { color: var(--faded-red); text-decoration-color: var(--faded-red); }
.edit-link-revert:disabled { opacity: 0.5; cursor: not-allowed; }
.edit-save-error {
  margin-top: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  background: var(--paper-sunken);
  border: 1px solid var(--danger);
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--danger);
}

/* ── Sections (collapsible via native <details>) ────────────── */
.section {
  border-bottom: 1px solid var(--rule);
  background: var(--paper-raised);
}

.section + .section { border-top: none; }
.section:last-of-type { margin-bottom: var(--space-xl); }

.section-summary {
  cursor: pointer;
  list-style: none;
  padding: var(--space-md);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.section-summary::-webkit-details-marker { display: none; }
.section-summary::after {
  content: '▾';
  font-size: var(--size-label);
  color: var(--muted);
  transition: transform 150ms ease;
  flex-shrink: 0;
}
.section:not([open]) > .section-summary::after {
  transform: rotate(-90deg);
}
.section-summary:hover { background: var(--paper-sunken); }

.section-body {
  padding: 0 var(--space-md) var(--space-md);
}

.section-empty {
  margin: 0;
  padding: var(--space-xs) 0;
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--muted);
  font-style: italic;
}

.section-tools {
  display: flex;
  justify-content: flex-end;
  margin-bottom: var(--space-sm);
}

.section-heading {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: var(--tracking-caps);
  color: var(--muted);
  margin: 0;
}

.sort-btn {
  background: transparent;
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  font-size: var(--size-label);
  font-weight: 500;
  color: var(--ink);
  padding: var(--space-xs) var(--space-sm);
  cursor: pointer;
  white-space: nowrap;
  touch-action: manipulation;
}
.sort-btn:hover { background: var(--paper-sunken); }

/* ── Link list ──────────────────────────────────────────────── */
.link-list { display: flex; flex-direction: column; gap: var(--space-xs); }

.section-link {
  display: block;
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink);
  text-decoration: underline;
  text-decoration-color: var(--rule);
  text-underline-offset: 3px;
  padding: var(--space-xs) 0;
}
.section-link:hover { color: var(--faded-red); text-decoration-color: var(--faded-red); }

/* ── Relation rows (PART_OF preview) ───────────────────────── */
.relation-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.relation-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-xs) 0;
}

.relation-link {
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink);
  text-decoration: underline;
  text-decoration-color: var(--rule);
  text-underline-offset: 3px;
}
.relation-link:hover { color: var(--faded-red); text-decoration-color: var(--faded-red); }

.relation-role {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--ink-soft);
  padding: var(--space-xs) var(--space-sm);
  background: var(--paper-sunken);
  border-radius: var(--radius-pill);
}

.info-marker {
  width: 20px;
  height: 20px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--rule);
  background: var(--paper);
  color: var(--ink-soft);
  font-family: var(--font-serif);
  font-size: var(--size-label);
  font-weight: 600;
  font-style: italic;
  line-height: 1;
  cursor: pointer;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 120ms ease-out, border-color 120ms ease-out, color 120ms ease-out;
  -webkit-tap-highlight-color: transparent;
}
.info-marker:hover {
  background: var(--faded-red);
  border-color: var(--faded-red);
  color: var(--paper);
}

.edit-pane {
  padding-bottom: var(--space-lg);
  border-bottom: 1px solid var(--rule);
  margin-bottom: var(--space-lg);
}

/* ── RelationListEditor slot — PART_OF edge fields ──────────── */
.unit-edge-row {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: var(--space-sm);
  align-items: center;
  margin-top: var(--space-sm);
}
.unit-edge-label {
  font-family: var(--font-sans);
  font-size: var(--size-label);
  font-weight: 500;
  color: var(--ink-soft);
}
.edit-input-order { max-width: 100px; font-family: var(--font-mono); font-size: var(--size-mono); }

/* ── Event items ────────────────────────────────────────────── */
.event-item {
  display: flex;
  align-items: baseline;
  gap: var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  margin: 0 calc(var(--space-sm) * -1);
  text-decoration: none;
  color: var(--ink);
  border-bottom: 1px solid var(--rule);
  border-radius: var(--radius-md);
  transition: background 120ms ease-out;
}
.event-item:last-child { border-bottom: none; }
.event-item:hover { background: var(--paper-sunken); }
.event-item:hover .event-title { color: var(--faded-red); }

.event-date {
  font-family: var(--font-mono);
  font-size: var(--size-mono);
  font-weight: 500;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  flex-shrink: 0;
}

.event-title {
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink);
  flex: 1;
  min-width: 0;
}

/* ── Person items ───────────────────────────────────────────── */
.person-item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  margin: 0 calc(var(--space-sm) * -1);
  text-decoration: none;
  border-radius: var(--radius-md);
  transition: background 120ms ease-out;
}
.person-item:hover { background: var(--paper-sunken); }
.person-item:hover .person-name { color: var(--faded-red); }

.person-name {
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink);
}

.person-count {
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--muted);
  white-space: nowrap;
  flex-shrink: 0;
}

/* ── External reference rows ─────────────────────────────────── */
.ref-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  margin: 0 calc(var(--space-sm) * -1);
  text-decoration: none;
  color: var(--ink);
  border-radius: var(--radius-md);
  transition: background 120ms ease-out;
}
.ref-item:hover { background: var(--paper-sunken); }
.ref-item:hover .ref-title { color: var(--faded-red); }

.ref-title {
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ref-meta {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex-shrink: 0;
}

.ref-nb {
  display: inline-block;
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-pill);
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  background: var(--moss);
  color: var(--paper);
}

.ref-domain {
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
</style>
