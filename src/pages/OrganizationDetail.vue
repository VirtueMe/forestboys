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

      <section class="edit-section">
        <h3 class="edit-section-heading">Beskrivelse</h3>
        <SectionsEditor :sections="sectionDraft" />
      </section>
      <footer v-if="sectionsDirty" class="edit-save-bar">
        <span class="edit-save-prompt">Ser det bra ut?</span>
        <button type="button" class="edit-btn-primary" :disabled="sectionsSaving" @click="saveSections">
          {{ sectionsSaving ? 'Lagrer…' : 'Lagre' }}
        </button>
        <button type="button" class="edit-link-revert" :disabled="sectionsSaving" @click="revertSections">Angre</button>
      </footer>
      <div v-if="sectionsError" class="edit-save-error">{{ sectionsError }}</div>

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

      <!-- Beskrivelse (HAS_CONTENT sections with citations + Kilder footer) -->
      <details v-if="mode !== 'edit' && sectionsForPreview.length" class="section" open>
        <summary class="section-summary">
          <h3 class="section-heading">Beskrivelse</h3>
        </summary>
        <div class="section-body">
          <template v-for="entry in sectionsForPreview" :key="entry.order">
            <div class="section-wrap">
              <!-- eslint-disable vue/no-v-html -->
              <div
                class="portable-text"
                :class="{ 'is-quote': entry.section.citations.length > 0 || entry.section.sourcedFrom }"
                v-html="entry.html"
              ></div>
              <!-- eslint-enable vue/no-v-html -->
              <div v-if="entry.section.sourcedFrom" class="sourced-from">
                <span class="sourced-label">Fra:</span>
                <a
                  v-if="entry.section.sourcedFrom.url"
                  :href="entry.section.sourcedFrom.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="sourced-link"
                >{{ entry.section.sourcedFrom.attribution || entry.section.sourcedFrom.title || entry.section.sourcedFrom.id }} ↗</a>
                <span v-else class="sourced-link">{{ entry.section.sourcedFrom.attribution || entry.section.sourcedFrom.title || entry.section.sourcedFrom.id }}</span>
                <span v-if="entry.section.sourcedFrom.license" class="sourced-license">{{ entry.section.sourcedFrom.license }}</span>
              </div>
              <div v-if="inlineCites(entry.section).length" class="inline-cites">
                <a
                  v-for="c in inlineCites(entry.section)"
                  :key="c.source.id"
                  :href="c.source.url ?? '#'"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="cite-chip"
                >
                  {{ c.source.title || c.source.id }}
                  <span v-if="c.source.authorFreeText" class="cite-chip-author">— {{ c.source.authorFreeText }}</span>
                  <span class="cite-chip-arrow">↗</span>
                </a>
              </div>
              <div v-if="sectionFootnoteCites(entry.section).length" class="section-footnotes">
                <sup v-for="c in sectionFootnoteCites(entry.section)" :key="c.source.id">[{{ c.footnoteNumber }}]</sup>
              </div>
            </div>
          </template>
          <footer v-if="orgFootnotes.length" class="card-kilder">
            <div class="kilder-label">Kilder</div>
            <ol class="kilder-list">
              <li v-for="c in orgFootnotes" :key="c.source.id" :value="c.footnoteNumber">
                <component
                  :is="c.source.url ? 'a' : 'span'"
                  v-bind="c.source.url ? { href: c.source.url, target: '_blank', rel: 'noopener noreferrer' } : {}"
                  class="kilder-ref"
                >{{ c.source.title || c.source.id
                  }}<span v-if="c.source.authorFreeText" class="kilder-author"> — {{ c.source.authorFreeText }}</span>
                </component>
                <span v-if="c.source.url" class="kilder-arrow"> ↗</span>
              </li>
            </ol>
          </footer>
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
import { ref, computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { neo4jQuery } from '../composables/useNeo4j.ts'
import { authFetch } from '../composables/useAuth.ts'
import { blocksToHtml } from '../utils/portableText.ts'
import DetailPage from '../components/DetailPage.vue'
import ImageSlider, { type SlideImage } from '../components/ImageSlider.vue'
import AdminViewTabs, { type AdminViewMode } from '../components/AdminViewTabs.vue'
import SectionsEditor, { type Section, type Citation } from '../components/SectionsEditor.vue'
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

const sectionDraft    = ref<Section[]>([])
const sectionOriginal = ref<Section[]>([])
const sectionsSaving  = ref(false)
const sectionsError   = ref<string | null>(null)

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
  sectionDraft.value    = []
  sectionOriginal.value = []
  sectionsError.value   = null
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

    const hydrated = sectionRows.map(rowToSection)
    sectionOriginal.value = hydrated
    sectionDraft.value    = hydrated.map(cloneSection)
    sectionsError.value   = null
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

function cloneSection(s: Section): Section {
  return {
    ...s,
    citations:   s.citations.map(c => ({ ...c, source: { ...c.source } })),
    sourcedFrom: s.sourcedFrom ? { ...s.sourcedFrom } : null,
  }
}

function sectionsSignature(arr: Section[]): string {
  return JSON.stringify(
    [...arr]
      .sort((a, b) => a.order - b.order)
      .map(s => [
        s.order,
        s.content,
        s.citations.map(c => [c.inline, c.source.id]),
        s.sourcedFrom?.id ?? null,
      ]),
  )
}

const sectionsDirty = computed(() =>
  sectionsSignature(sectionDraft.value) !== sectionsSignature(sectionOriginal.value),
)

function revertSections() {
  sectionDraft.value = sectionOriginal.value.map(cloneSection)
  sectionsError.value = null
}

async function saveSections() {
  const slug = String(route.params.slug)
  if (!slug) return
  sectionsSaving.value = true
  sectionsError.value  = null
  try {
    const payload = {
      sections: [...sectionDraft.value]
        .sort((a, b) => a.order - b.order)
        .map(s => ({
          order:          s.order,
          content:        s.content,
          citations:      s.citations.map(c => ({ inline: c.inline, sourceId: c.source.id })),
          sourcedFromId:  s.sourcedFrom?.id ?? null,
        })),
    }
    const res = await authFetch(`/api/admin/organization/${encodeURIComponent(slug)}/sections`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      sectionsError.value = body.error ?? `HTTP ${res.status}`
      return
    }
    sectionOriginal.value = sectionDraft.value.map(cloneSection)
  } catch (e) {
    sectionsError.value = (e as Error).message
  } finally {
    sectionsSaving.value = false
  }
}

interface RenderedSection {
  order: number
  html:  string
  section: Section
}

const sectionsForPreview = computed<RenderedSection[]>(() => {
  const source = sectionsDirty.value ? sectionDraft.value : sectionOriginal.value
  return [...source]
    .sort((a, b) => a.order - b.order)
    .map(s => {
      let html = ''
      try { html = blocksToHtml(JSON.parse(s.content) as unknown[]) } catch { /* skip */ }
      return { order: s.order, html, section: s }
    })
})

const orgFootnotes = computed<(Citation & { footnoteNumber: number })[]>(() => {
  const source = sectionsDirty.value ? sectionDraft.value : sectionOriginal.value
  const out: (Citation & { footnoteNumber: number })[] = []
  for (const s of [...source].sort((a, b) => a.order - b.order)) {
    for (const c of s.citations) {
      if (!c.inline) out.push({ ...c, footnoteNumber: out.length + 1 })
    }
  }
  return out
})

function inlineCites(s: Section): Citation[] { return s.citations.filter(c => c.inline) }
function sectionFootnoteCites(s: Section): (Citation & { footnoteNumber: number })[] {
  return orgFootnotes.value.filter(fn => s.citations.some(c => !c.inline && c.source.id === fn.source.id))
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

/* ── Admin: scalar editor ───────────────────────────────────── */
.edit-section {
  padding: 16px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}
.edit-section-heading {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin: 0 0 12px;
}
.edit-row {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 12px;
  align-items: center;
  margin-bottom: 10px;
}
.edit-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text);
}
.edit-input {
  width: 100%;
  padding: 8px 10px;
  font-size: 14px;
  color: var(--color-text);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  box-sizing: border-box;
  font-family: inherit;
}
.edit-input:focus {
  outline: 2px solid var(--color-navy);
  outline-offset: -1px;
  border-color: var(--color-navy);
}
.edit-input-date { font-family: monospace; font-size: 12px; max-width: 160px; }
.edit-color-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.edit-input-color-text { font-family: monospace; font-size: 12px; max-width: 140px; }
.edit-color-swatch {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  border: 1px solid var(--color-border-mid);
  flex-shrink: 0;
}
.edit-save-bar {
  margin-top: 12px;
  padding: 10px 14px;
  background: #fef3c7;
  border: 1px solid #fcd34d;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.edit-save-prompt { flex: 1; font-size: 13px; color: #92400e; font-weight: 600; }
.edit-btn-primary {
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 600;
  background: var(--color-navy);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
.edit-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.edit-link-revert {
  background: transparent;
  border: none;
  padding: 0;
  font-size: 12px;
  color: #92400e;
  text-decoration: underline;
  cursor: pointer;
}
.edit-link-revert:disabled { opacity: 0.5; cursor: not-allowed; }
.edit-save-error {
  margin-top: 8px;
  padding: 8px 10px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  font-size: 12px;
  color: #b91c1c;
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

.section-wrap { position: relative; }
.section-wrap + .section-wrap { margin-top: 8px; }

.is-quote {
  border-left: 3px solid var(--color-border);
  padding: 2px 14px;
  margin: 12px 0 12px 2px;
  font-style: italic;
  color: var(--color-text);
}

.sourced-from {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  margin: -6px 0 12px 18px;
  font-size: 11px;
  color: var(--color-muted);
}
.sourced-label  { font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; font-size: 10px; }
.sourced-link   { color: var(--color-navy); text-decoration: underline; }
.sourced-license {
  font-family: monospace;
  font-size: 10px;
  padding: 1px 6px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  color: var(--color-muted);
}

.inline-cites {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 6px 0 10px;
}
.cite-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  padding: 3px 8px;
  font-size: 11px;
  color: var(--color-navy);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  text-decoration: none;
}
.cite-chip:hover       { border-color: var(--color-navy); }
.cite-chip-author      { color: var(--color-muted); }
.cite-chip-arrow       { font-size: 10px; opacity: 0.6; }

.section-footnotes {
  position: absolute;
  right: 0;
  bottom: 0;
  display: flex;
  gap: 2px;
  font-size: 11px;
  color: var(--color-muted);
}

.card-kilder {
  border-top: 1px solid var(--color-border);
  margin-top: 12px;
  padding-top: 10px;
}
.kilder-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin-bottom: 6px;
}
.kilder-list {
  margin: 0;
  padding-left: 22px;
  font-size: 11px;
  color: var(--color-muted);
  line-height: 1.5;
}
.kilder-list li        { margin-bottom: 3px; }
.kilder-ref            { color: inherit; text-decoration: none; }
.kilder-list a.kilder-ref { color: var(--color-navy); text-decoration: underline; }
.kilder-list a.kilder-ref .kilder-author { color: var(--color-muted); }
.kilder-arrow { font-size: 10px; opacity: 0.6; color: var(--color-navy); }

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

.edit-pane { padding-bottom: 24px; border-bottom: 1px solid var(--color-border); margin-bottom: 24px; }

/* ── RelationListEditor slot — PART_OF edge fields ──────────── */
.unit-edge-row {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 10px;
  align-items: center;
  margin-top: 6px;
}
.unit-edge-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--color-muted);
}
.edit-input-order { max-width: 100px; font-family: monospace; }

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
