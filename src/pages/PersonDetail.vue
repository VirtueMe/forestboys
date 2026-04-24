<template>
  <DetailPage
    :load="loadPerson"
    :reset="resetPerson"
    :not-found="!person"
    not-found-text="Person ikke funnet."
    page-class="person-page"
  >
    <div v-if="person" itemscope itemtype="https://schema.org/Person">
      <AdminViewTabs v-model="mode" />

      <div v-if="mode === 'edit'" class="edit-pane">
        <section class="edit-section">
          <h3 class="edit-section-heading">Grunnleggende</h3>
          <div class="edit-row">
            <label class="edit-label">Type</label>
            <div class="type-seg">
              <label class="type-seg-opt" :class="{ active: editForm.type === 'civilian' }">
                <input type="radio" value="civilian" v-model="editForm.type" />
                Sivil
              </label>
              <label class="type-seg-opt" :class="{ active: editForm.type === 'soldier' }">
                <input type="radio" value="soldier" v-model="editForm.type" />
                Soldat
              </label>
            </div>
          </div>
          <div class="edit-row">
            <label class="edit-label" for="edit-canonicalName">Navn</label>
            <input
              id="edit-canonicalName"
              v-model="editForm.canonicalName"
              class="edit-input"
              type="text"
              required
            />
          </div>
          <div class="edit-row">
            <label class="edit-label" for="edit-secretName">Dekknavn</label>
            <input
              id="edit-secretName"
              v-model="editForm.secretName"
              class="edit-input"
              type="text"
            />
          </div>
          <div class="edit-row">
            <label class="edit-label" for="edit-birthYear">Fødselsår</label>
            <input
              id="edit-birthYear"
              v-model="editForm.birthYear"
              class="edit-input edit-input-narrow"
              type="text"
              inputmode="numeric"
              placeholder="åååå"
            />
          </div>
          <div class="edit-row">
            <label class="edit-label" for="edit-home">Hjemsted</label>
            <input
              id="edit-home"
              v-model="editForm.home"
              class="edit-input"
              type="text"
            />
          </div>
        </section>

        <footer v-if="editDirty" class="edit-save-bar">
          <span class="edit-save-prompt">Ser det bra ut?</span>
          <button type="button" class="edit-btn-primary" :disabled="editSaving" @click="saveEdit">
            {{ editSaving ? 'Lagrer…' : 'Lagre' }}
          </button>
          <button type="button" class="edit-link-revert" :disabled="editSaving" @click="revertEdit">Angre</button>
        </footer>
        <div v-if="editError" class="edit-save-error">{{ editError }}</div>

        <section v-if="editForm.type === 'soldier'" class="edit-section">
          <div class="edit-section-head">
            <h3 class="edit-section-heading">Grad</h3>
            <button type="button" class="edit-btn-outline" @click="addRank">+ Legg til grad</button>
          </div>
          <div v-if="!rankDraft.length" class="edit-empty">Ingen grad</div>
          <div
            v-for="(r, i) in rankDraft"
            :key="i"
            class="rank-edit-row"
          >
            <select
              :value="r.rankSlug"
              class="edit-input rank-edit-select"
              @change="setRankSlug(i, ($event.target as HTMLSelectElement).value)"
            >
              <option v-for="opt in allRanks" :key="opt.slug" :value="opt.slug">
                {{ opt.name }}
              </option>
            </select>
            <input
              class="edit-input edit-input-year"
              type="text"
              inputmode="numeric"
              placeholder="fra"
              :value="yearModel(i, 'from')"
              @input="setYear(i, 'from', ($event.target as HTMLInputElement).value)"
            />
            <span class="rank-dash">–</span>
            <input
              class="edit-input edit-input-year"
              type="text"
              inputmode="numeric"
              placeholder="til"
              :value="yearModel(i, 'to')"
              @input="setYear(i, 'to', ($event.target as HTMLInputElement).value)"
            />
            <button type="button" class="rank-remove-btn" aria-label="Fjern" @click="removeRank(i)">✕</button>
          </div>
        </section>

        <footer v-if="editForm.type === 'soldier' && ranksDirty" class="edit-save-bar">
          <span class="edit-save-prompt">Ser det bra ut?</span>
          <button type="button" class="edit-btn-primary" :disabled="ranksSaving" @click="saveRanks">
            {{ ranksSaving ? 'Lagrer…' : 'Lagre' }}
          </button>
          <button type="button" class="edit-link-revert" :disabled="ranksSaving" @click="revertRanks">Angre</button>
        </footer>
        <div v-if="editForm.type === 'soldier' && ranksError" class="edit-save-error">{{ ranksError }}</div>

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
          v-if="neo4jPerson"
          :parent-slug="neo4jPerson.slug"
          :entries="membershipEntries"
          :targets="membershipTargets"
          :strategy="MembershipStrategy"
          label="Medlemskap"
          add-label="+ Legg til medlemskap"
          empty-label="Ingen medlemskap"
          search-placeholder="Søk enhet…"
          picker-chip-aria="Bytt enhet"
          validation-empty="Velg enhet for alle medlemskap før du lagrer."
          show-role
          :role-options="ROLE_LABEL"
          default-role="member"
        />

        <RelationListEditor
          v-if="neo4jPerson"
          :parent-slug="neo4jPerson.slug"
          :entries="attendanceEntries"
          :targets="attendanceTargets"
          :strategy="AttendanceStrategy"
          label="Kurs"
          add-label="+ Legg til kurs"
          empty-label="Ingen kurs"
          search-placeholder="Søk kurs…"
          picker-chip-aria="Bytt kurs"
          validation-empty="Velg kurs for alle oppføringer før du lagrer."
          show-passed
        />

        <RelationListEditor
          v-if="neo4jPerson"
          :parent-slug="neo4jPerson.slug"
          :entries="operationEntries"
          :targets="operationTargets"
          :strategy="OperationStrategy"
          label="Operasjoner"
          add-label="+ Legg til operasjon"
          empty-label="Ingen operasjoner"
          search-placeholder="Søk operasjon…"
          picker-chip-aria="Bytt operasjon"
          validation-empty="Velg operasjon for alle oppføringer før du lagrer."
          :show-dates="false"
          create-label="+ Opprett ny operasjon"
          :create-href="createEventHref('operation')"
          :expand-slug="pendingExpandEvent"
        />

        <RelationListEditor
          v-if="neo4jPerson"
          :parent-slug="neo4jPerson.slug"
          :entries="incidentEntries"
          :targets="incidentTargets"
          :strategy="IncidentStrategy"
          label="Hendelser"
          add-label="+ Legg til hendelse"
          empty-label="Ingen hendelser"
          search-placeholder="Søk hendelse…"
          picker-chip-aria="Bytt hendelse"
          validation-empty="Velg hendelse for alle oppføringer før du lagrer."
          :show-dates="false"
          create-label="+ Opprett ny hendelse"
          :create-href="createEventHref('incident')"
          :expand-slug="pendingExpandEvent"
        />
      </div>

      <!-- Hero image (reserves the same vertical space when no image exists) -->
      <div class="hero" :class="{ 'hero--empty': !heroUrl }">
        <img
          v-if="heroUrl"
          :src="heroUrl"
          :alt="person.name"
          class="hero-img"
          itemprop="image"
        />
        <span v-else class="hero-placeholder" aria-hidden="true">{{ personInitials }}</span>
      </div>

      <!-- Header -->
      <div class="page-header">
        <RouterLink to="/registre" class="back-link">&#x2039; Tilbake</RouterLink>
        <h1 class="person-name" itemprop="name">{{ personTitle }}</h1>
        <meta v-if="person.secretName" :content="person.secretName" itemprop="alternateName" />
        <meta v-if="person.birthYear" :content="String(person.birthYear)" itemprop="birthDate" />
        <p v-if="person.home" class="person-meta" itemprop="homeLocation">{{ person.home }}</p>
        <ul v-if="person.type === 'soldier' && ranksForPreview.length" class="rank-list">
          <li v-for="r in ranksForPreview" :key="`${r.rankSlug}-${r.from}-${r.to}`" class="rank-row">
            <span class="rank-name">{{ r.rankName || r.rankSlug }}</span>
            <span v-if="rankPeriod(r)" class="rank-period">{{ rankPeriod(r) }}</span>
          </li>
        </ul>
      </div>

      <!-- Beskrivelse -->
      <section v-if="sectionsForPreview.length || person.descriptionHtml || person.description" class="section">
        <h3 class="section-heading">Beskrivelse</h3>
        <template v-if="sectionsForPreview.length">
          <template v-for="entry in sectionsForPreview" :key="entry.order">
            <div class="section-wrap">
              <!-- eslint-disable vue/no-v-html -->
              <div
                class="rich-text portable-text"
                :class="{ 'is-quote': entry.section.citations.length > 0 || entry.section.sourcedFrom }"
                itemprop="description"
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
          <footer v-if="personFootnotes.length" class="card-kilder">
            <div class="kilder-label">Kilder</div>
            <ol class="kilder-list">
              <li v-for="c in personFootnotes" :key="c.source.id" :value="c.footnoteNumber">
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
        </template>
        <!-- Legacy fallback — Sanity-era descriptionHtml / description -->
        <template v-else>
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div v-if="person.descriptionHtml" class="rich-text" itemprop="description" v-html="person.descriptionHtml"></div>
          <p v-else class="plain-text">{{ person.description }}</p>
        </template>
      </section>

      <RelationListView
        :entries="membershipEntries"
        :strategy="MembershipStrategy"
        label="Medlemskap"
        show-role
        :role-options="ROLE_LABEL"
        @open="openMembership"
      />

      <RelationListView
        :entries="attendanceEntries"
        :strategy="AttendanceStrategy"
        label="Kurs"
        show-passed
        @open="openAttendance"
      />

      <RelationListView
        :entries="operationEntries"
        :strategy="OperationStrategy"
        label="Operasjoner"
        @open="openOperation"
      />

      <RelationListView
        :entries="incidentEntries"
        :strategy="IncidentStrategy"
        label="Hendelser"
        @open="openIncident"
      />

      <RelationInfoPopup
        :entry="activeRelation"
        :show-role="activeRelationShowsRole"
        :show-passed="activeRelationShowsPassed"
        :role-options="ROLE_LABEL"
        @close="activeRelation = null"
      />

      <!-- Hendelser (legacy IDB fallback — Neo4j Incident list above takes precedence) -->
      <section v-if="person.events?.length && !incidentEntries.length" class="section">
        <div class="section-header-row">
          <h3 class="section-heading">Hendelser ({{ person.events.length }})</h3>
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
            <span v-if="eventTags(event).length" class="event-tags">
              <span v-for="tag in eventTags(event)" :key="tag" class="event-tag">{{ tag }}</span>
            </span>
          </RouterLink>
        </div>
      </section>

      <!-- Steder -->
      <section v-if="person.locations?.length" class="section">
        <h3 class="section-heading">Vært stasjonert på</h3>
        <div class="link-list">
          <RouterLink
            v-for="loc in person.locations"
            :key="loc.slug"
            :to="`/map/${loc.slug}`"
            class="section-link"
          >
            {{ loc.title }}
          </RouterLink>
        </div>
      </section>

      <!-- Baser -->
      <section v-if="person.stations?.length" class="section">
        <h3 class="section-heading">Gjennomgått trening på</h3>
        <div class="link-list">
          <RouterLink
            v-for="s in person.stations"
            :key="s.slug"
            :to="`/station/${s.slug}`"
            class="section-link"
          >
            {{ s.title }}
          </RouterLink>
        </div>
      </section>

      <!-- Annen informasjon -->
      <section v-if="outlines.length" class="section">
        <h3 class="section-heading">Annen informasjon</h3>
        <div class="link-list">
          <RouterLink
            v-for="o in outlines"
            :key="o.slug"
            :to="`/outlines/${o.slug}`"
            class="section-link"
          >
            {{ o.title }}
          </RouterLink>
        </div>
      </section>

      <!-- Video -->
      <section v-if="person.movie" class="section">
        <h3 class="section-heading">Video</h3>
        <video controls class="video-player">
          <source :src="person.movie" type="video/mp4" />
        </video>
      </section>

      <!-- Galleri — direct + propagated via incidents/operations/unit/orgs -->
      <section v-if="galleryImages.length" class="section">
        <h3 class="section-heading">Galleri ({{ galleryImages.length }})</h3>
        <ImageSlider :images="galleryImages" />
      </section>

      <!-- Lenker -->
      <section class="section">
        <h3 class="section-heading">Lenker<span v-if="externalRefs.length"> ({{ externalRefs.length }})</span></h3>
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
      </section>
    </div>
  </DetailPage>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useLocationCache } from '../composables/useLocationCache.ts'
import { neo4jQuery } from '../composables/useNeo4j.ts'
import type { IdbEvent } from '../types/idb.ts'
import DetailPage from '../components/DetailPage.vue'
import ImageSlider, { type SlideImage } from '../components/ImageSlider.vue'
import AdminViewTabs, { type AdminViewMode } from '../components/AdminViewTabs.vue'
import SectionsEditor, { type Section, type Citation } from '../components/SectionsEditor.vue'
import RelationListView    from '../components/relation/RelationListView.vue'
import RelationInfoPopup   from '../components/relation/RelationInfoPopup.vue'
import RelationListEditor  from '../components/relation/RelationListEditor.vue'
import type { RelationEntry, RelationTarget } from '../components/relation/RelationStrategy.ts'
import { MembershipStrategy, AttendanceStrategy, IncidentStrategy, OperationStrategy, ROLE_LABEL } from '../components/relation/strategies.ts'
import { authFetch } from '../composables/useAuth.ts'
import { blocksToHtml } from '../utils/portableText.ts'

const { people, init } = useLocationCache()

const route  = useRoute()
const router = useRouter()

const mode = ref<AdminViewMode>('preview')
/** Captures ?expandEvent=... from the router once so the editor can latch
 *  onto it even after we strip the query param. */
const pendingExpandEvent = ref<string | null>(null)

function createEventHref(kind: 'incident' | 'operation'): string {
  const slug = neo4jPerson.value?.slug ?? ''
  const q = new URLSearchParams({ kind, forPerson: slug, returnTo: `/person/${slug}` })
  return `/admin/event/new?${q.toString()}`
}

watch(
  () => route.query.expandEvent,
  (q) => {
    if (typeof q !== 'string' || !q) return
    pendingExpandEvent.value = q
    mode.value = 'edit'
    const { expandEvent: _drop, ...rest } = route.query
    void router.replace({ path: route.path, query: rest })
  },
  { immediate: true },
)

type PersonType = 'civilian' | 'soldier'

interface Neo4jPerson {
  slug: string
  name: string
  secretName: string | null
  home: string | null
  birthYear: number | null
  status: string | null
  serviceClass: string | null
  type: PersonType
}
const neo4jPerson = ref<Neo4jPerson | null>(null)

// ── Grunnleggende edit form (admin) ────────────────────────────────────
interface EditForm {
  canonicalName: string
  secretName:    string
  birthYear:     string // input value; parsed to int on save
  home:          string
  type:          PersonType
}

const emptyForm: EditForm = { canonicalName: '', secretName: '', birthYear: '', home: '', type: 'civilian' }
const editForm     = ref<EditForm>({ ...emptyForm })
const editOriginal = ref<EditForm>({ ...emptyForm })
const editSaving   = ref(false)
const editError    = ref<string | null>(null)

function resetEditForm() {
  const p = neo4jPerson.value
  if (!p) return
  const snapshot: EditForm = {
    canonicalName: p.name ?? '',
    secretName:    p.secretName ?? '',
    birthYear:     p.birthYear != null ? String(p.birthYear) : '',
    home:          p.home ?? '',
    type:          p.type ?? 'civilian',
  }
  editForm.value     = { ...snapshot }
  editOriginal.value = { ...snapshot }
  editError.value    = null
}

watch(neo4jPerson, resetEditForm, { immediate: true })

const editDirty = computed(() =>
  (Object.keys(editForm.value) as (keyof EditForm)[]).some(k => editForm.value[k] !== editOriginal.value[k]),
)

function revertEdit() {
  editForm.value = { ...editOriginal.value }
  editError.value = null
}

async function saveEdit() {
  if (!neo4jPerson.value) return
  editSaving.value = true
  editError.value  = null
  try {
    const body: Record<string, unknown> = {}
    const f = editForm.value, o = editOriginal.value
    if (f.canonicalName !== o.canonicalName) body.canonicalName = f.canonicalName.trim()
    if (f.secretName    !== o.secretName)    body.secretName    = f.secretName.trim() || null
    if (f.home          !== o.home)          body.home          = f.home.trim() || null
    if (f.type          !== o.type)          body.type          = f.type
    if (f.birthYear     !== o.birthYear) {
      const trimmed = f.birthYear.trim()
      if (!trimmed) body.birthYear = null
      else {
        const n = Number(trimmed)
        if (!Number.isInteger(n)) { editError.value = 'Fødselsår må være et heltall'; editSaving.value = false; return }
        body.birthYear = n
      }
    }
    if (!Object.keys(body).length) { editSaving.value = false; return }

    const res = await authFetch(`/api/admin/person/${encodeURIComponent(neo4jPerson.value.slug)}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    const out = await res.json().catch(() => ({})) as {
      canonicalName?: string; secretName?: string | null; birthYear?: number | null; home?: string | null; type?: PersonType; error?: string
    }
    if (!res.ok) {
      editError.value = out.error ?? `HTTP ${res.status}`
      return
    }
    const p = neo4jPerson.value
    if (p) {
      if (out.canonicalName !== undefined) p.name       = out.canonicalName
      if (out.secretName    !== undefined) p.secretName = out.secretName
      if (out.birthYear     !== undefined) p.birthYear  = out.birthYear
      if (out.home          !== undefined) p.home       = out.home
      if (out.type          !== undefined) p.type       = out.type
    }
    resetEditForm()
  } catch (e) {
    editError.value = (e as Error).message
  } finally {
    editSaving.value = false
  }
}

const heroImage     = ref<{ url: string; caption: string | null } | null>(null)
const galleryImages = ref<SlideImage[]>([])
const externalRefs  = ref<{ id: string; title: string | null; url: string; type: string; domain: string | null; nbBacked: boolean }[]>([])

interface HeldRank {
  rankSlug: string
  rankName: string
  tier:     number | null
  from:     number | null
  to:       number | null
}
interface RankOption { slug: string; name: string; tier: number | null }

const heldRanks = ref<HeldRank[]>([])
const allRanks  = ref<RankOption[]>([])

/** Local editable copy used in Rediger mode. */
const rankDraft    = ref<HeldRank[]>([])
const rankOriginal = ref<HeldRank[]>([])
const ranksSaving  = ref(false)
const ranksError   = ref<string | null>(null)

function resetRankDraft() {
  rankDraft.value    = heldRanks.value.map(r => ({ ...r }))
  rankOriginal.value = heldRanks.value.map(r => ({ ...r }))
  ranksError.value   = null
}

watch(heldRanks, resetRankDraft, { deep: true, immediate: true })

function sigRanks(arr: HeldRank[]): string {
  return JSON.stringify([...arr].map(r => [r.rankSlug, r.from, r.to]))
}

const ranksDirty = computed(() => sigRanks(rankDraft.value) !== sigRanks(rankOriginal.value))

function addRank() {
  const first = allRanks.value[0]
  rankDraft.value.push({
    rankSlug: first?.slug ?? '',
    rankName: first?.name ?? '',
    tier:     first?.tier ?? null,
    from:     null,
    to:       null,
  })
}

function removeRank(i: number) {
  rankDraft.value.splice(i, 1)
}

function setRankSlug(i: number, slug: string) {
  const option = allRanks.value.find(r => r.slug === slug)
  if (!option) return
  const row = rankDraft.value[i]
  if (!row) return
  row.rankSlug = option.slug
  row.rankName = option.name
  row.tier     = option.tier
}

function yearModel(i: number, key: 'from' | 'to'): string {
  return rankDraft.value[i]?.[key] != null ? String(rankDraft.value[i]?.[key]) : ''
}

function setYear(i: number, key: 'from' | 'to', value: string) {
  const row = rankDraft.value[i]
  if (!row) return
  const trimmed = value.trim()
  if (!trimmed) { row[key] = null; return }
  const n = Number(trimmed)
  if (Number.isInteger(n)) row[key] = n
}

function revertRanks() {
  rankDraft.value = rankOriginal.value.map(r => ({ ...r }))
  ranksError.value = null
}

async function saveRanks() {
  if (!neo4jPerson.value) return
  ranksSaving.value = true
  ranksError.value  = null
  try {
    const payload = {
      ranks: rankDraft.value.map(r => ({
        rankSlug: r.rankSlug,
        from:     r.from,
        to:       r.to,
      })),
    }
    const res = await authFetch(`/api/admin/person/${encodeURIComponent(neo4jPerson.value.slug)}/ranks`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      ranksError.value = body.error ?? `HTTP ${res.status}`
      return
    }
    heldRanks.value = rankDraft.value.map(r => ({ ...r }))
    resetRankDraft()
  } catch (e) {
    ranksError.value = (e as Error).message
  } finally {
    ranksSaving.value = false
  }
}

/** Overlay for the preview: in edit mode, show the draft instead of saved ranks. */
const ranksForPreview = computed<HeldRank[]>(() =>
  ranksDirty.value ? rankDraft.value : heldRanks.value,
)

function rankPeriod(r: HeldRank): string {
  if (r.from == null && r.to == null) return ''
  if (r.from != null && r.to != null && r.from === r.to) return String(r.from)
  return `${r.from ?? '?'}–${r.to ?? ''}`
}

// ── Beskrivelse (Description sections) ─────────────────────────────────
interface SectionRow {
  order:        number | null
  content:      string | null
  citations:    {
    inline:        boolean | null
    sourceId:      string | null
    sourceTitle:   string | null
    sourceUrl:     string | null
    sourceAuthor:  string | null
  }[]
  sourcedFrom: {
    id:             string
    title:          string | null
    url:            string | null
    authorFreeText: string | null
    license:        string | null
    attribution:    string | null
  } | null
}

const sectionDraft    = ref<Section[]>([])
const sectionOriginal = ref<Section[]>([])
const sectionsSaving  = ref(false)
const sectionsError   = ref<string | null>(null)

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

const sectionsDirty = computed(() => sectionsSignature(sectionDraft.value) !== sectionsSignature(sectionOriginal.value))

function revertSections() {
  sectionDraft.value = sectionOriginal.value.map(cloneSection)
  sectionsError.value = null
}

async function saveSections() {
  if (!neo4jPerson.value) return
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
    const res = await authFetch(`/api/admin/person/${encodeURIComponent(neo4jPerson.value.slug)}/sections`, {
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

function footnotesForCard(): (Citation & { footnoteNumber: number })[] {
  const source = sectionsDirty.value ? sectionDraft.value : sectionOriginal.value
  const out: (Citation & { footnoteNumber: number })[] = []
  for (const s of [...source].sort((a, b) => a.order - b.order)) {
    for (const c of s.citations) {
      if (!c.inline) out.push({ ...c, footnoteNumber: out.length + 1 })
    }
  }
  return out
}

const personFootnotes = computed(() => footnotesForCard())

function inlineCites(s: Section): Citation[] { return s.citations.filter(c => c.inline) }
function sectionFootnoteCites(s: Section): (Citation & { footnoteNumber: number })[] {
  return personFootnotes.value.filter(fn => s.citations.some(c => !c.inline && c.source.id === fn.source.id))
}

// ── Medlemskap & Kurs (via shared Relation strategies) ────────────────
const membershipEntries  = ref<RelationEntry[]>([])
const membershipTargets  = ref<RelationTarget[]>([])
const attendanceEntries  = ref<RelationEntry[]>([])
const attendanceTargets  = ref<RelationTarget[]>([])
const incidentEntries    = ref<RelationEntry[]>([])
const incidentTargets    = ref<RelationTarget[]>([])
const operationEntries   = ref<RelationEntry[]>([])
const operationTargets   = ref<RelationTarget[]>([])

// Preview popup — shared between Medlemskap and Kurs since both feed
// RelationInfoPopup with the same shape.
const activeRelation           = ref<RelationEntry | null>(null)
const activeRelationShowsRole   = ref(false)
const activeRelationShowsPassed = ref(false)
function openMembership(e: RelationEntry) {
  activeRelation.value = e
  activeRelationShowsRole.value   = true
  activeRelationShowsPassed.value = false
}
function openAttendance(e: RelationEntry) {
  activeRelation.value = e
  activeRelationShowsRole.value   = false
  activeRelationShowsPassed.value = true
}
function openIncident(e: RelationEntry) {
  activeRelation.value = e
  activeRelationShowsRole.value   = false
  activeRelationShowsPassed.value = false
}
function openOperation(e: RelationEntry) {
  activeRelation.value = e
  activeRelationShowsRole.value   = false
  activeRelationShowsPassed.value = false
}

function resetPerson() {
  neo4jPerson.value   = null
  heroImage.value     = null
  galleryImages.value = []
  externalRefs.value  = []
  heldRanks.value     = []
  sectionDraft.value    = []
  sectionOriginal.value = []
  membershipEntries.value  = []
  membershipTargets.value  = []
  attendanceEntries.value  = []
  attendanceTargets.value  = []
  incidentEntries.value    = []
  incidentTargets.value    = []
  operationEntries.value   = []
  operationTargets.value   = []
  activeRelation.value = null
}

async function loadPerson(slug: string) {
  // IDB cache gives us optional rich extras (description, locations, stations,
  // movie, outlines) when a person was in the Sanity dump. Neo4j is the
  // source of existence — a person found in Neo4j but missing from IDB just
  // renders with fewer sections. No "auto" special-case needed.
  await init()

  // Core Person fields from Neo4j (authoritative for name, home, birthYear, …).
  // Hero + gallery + Lenker + Medlemskap + Hendelser follow below.
  //   1. Direct HAS_IMAGE with isHero = true
  //   2. Else direct Source with kind = 'portrait'
  //   3. Else first direct image by order (Sanity convention: gallery[0] ≈ portrait)
  try {
    const [
      personRows, heroRows, galleryRows, refRows,
      memberEntries, memberTargets, attendEntries, attendTargets,
      incidEntries, incidTargets, operEntries, operTargets,
      rankRows, allRankRows, sectionRows,
    ] = await Promise.all([
      neo4jQuery<Neo4jPerson>(
        `MATCH (p:Person {slug: $slug})
         RETURN p.slug AS slug, p.canonicalName AS name,
                p.secretName AS secretName, p.home AS home,
                p.birthYear AS birthYear, p.status AS status,
                p.serviceClass AS serviceClass,
                coalesce(p.type, 'civilian') AS type`,
        { slug },
      ),
      neo4jQuery<{ url: string; caption: string | null }>(
        `MATCH (p:Person {slug: $slug})-[h:HAS_IMAGE]->(s:Source)
         WITH s, h,
              CASE WHEN h.isHero = true      THEN 0
                   WHEN s.kind    = 'portrait' THEN 1
                                               ELSE 2 END AS tier
         RETURN s.url AS url, h.caption AS caption
         ORDER BY tier, h.order
         LIMIT 1`,
        { slug },
      ),
      // Gallery buckets: 0 own, 1 operations, 2 incidents, 3 unit, 4 orgs.
      neo4jQuery<{ url: string; caption: string | null; subjectName: string; subjectSlug: string; subjectType: string; sortKey: number }>(
        `MATCH (person:Person {slug: $slug})
         CALL {
           WITH person
           MATCH (person)-[h:HAS_IMAGE]->(s:Source)
           RETURN s.url AS url, h.caption AS caption,
                  person.canonicalName AS subjectName, person.slug AS subjectSlug,
                  'person' AS subjectType, 0 AS sortKey
           UNION
           WITH person
           MATCH (person)-[:INVOLVED_IN]->(:Incident)-[:PART_OF]->(op:Operation)-[h:HAS_IMAGE]->(s:Source)
           WHERE coalesce(h.scope, 'propagate') <> 'entity'
           RETURN s.url AS url, h.caption AS caption,
                  op.codeName AS subjectName, op.slug AS subjectSlug,
                  'operation' AS subjectType, 1 AS sortKey
           UNION
           WITH person
           MATCH (person)-[:INVOLVED_IN]->(i:Incident)-[h:HAS_IMAGE]->(s:Source)
           WHERE coalesce(h.scope, 'propagate') <> 'entity'
           RETURN s.url AS url, h.caption AS caption,
                  i.title AS subjectName, i.slug AS subjectSlug,
                  'incident' AS subjectType, 2 AS sortKey
           UNION
           WITH person
           MATCH (person)-[:MEMBER_OF]->(u:Unit)-[h:HAS_IMAGE]->(s:Source)
           WHERE coalesce(h.scope, 'propagate') <> 'entity'
           RETURN s.url AS url, h.caption AS caption,
                  u.canonicalName AS subjectName, u.slug AS subjectSlug,
                  'unit' AS subjectType, 3 AS sortKey
           UNION
           WITH person
           MATCH (person)-[:MEMBER_OF]-(x)-[:PART_OF*0..]->(o:Organization)-[h:HAS_IMAGE]->(s:Source)
           WHERE coalesce(h.scope, 'propagate') <> 'entity'
           RETURN s.url AS url, h.caption AS caption,
                  o.canonicalName AS subjectName, o.slug AS subjectSlug,
                  'organization' AS subjectType, 4 AS sortKey
         }
         RETURN url, caption, subjectName, subjectSlug, subjectType, sortKey
         ORDER BY sortKey, subjectName
         LIMIT 200`,
        { slug },
      ),
      // External references — Sources this Person is REFERENCED_IN.
      // NB-backed sources sort first, then by type, then by title.
      neo4jQuery<{ id: string; title: string | null; url: string; type: string; domain: string | null; nbBacked: boolean }>(
        `MATCH (p:Person {slug: $slug})-[:REFERENCED_IN]->(s:Source)
         RETURN s.id AS id, s.title AS title, s.url AS url,
                s.type AS type, s.domain AS domain,
                coalesce(s.nbBacked, false) AS nbBacked
         ORDER BY nbBacked DESC, s.type, coalesce(s.title, s.url)`,
        { slug },
      ),
      MembershipStrategy.fetchEntries(slug),
      MembershipStrategy.fetchTargets(),
      AttendanceStrategy.fetchEntries(slug),
      AttendanceStrategy.fetchTargets(),
      IncidentStrategy.fetchEntries(slug),
      IncidentStrategy.fetchTargets(),
      OperationStrategy.fetchEntries(slug),
      OperationStrategy.fetchTargets(),
      neo4jQuery<HeldRank>(
        `MATCH (p:Person {slug: $slug})-[h:HELD_RANK]->(r:Rank)
         RETURN r.slug AS rankSlug, r.canonicalName AS rankName, r.tier AS tier,
                h.from AS from, h.to AS to
         ORDER BY coalesce(h.from, 0), r.tier`,
        { slug },
      ),
      neo4jQuery<RankOption>(
        `MATCH (r:Rank)
         RETURN r.slug AS slug, r.canonicalName AS name, r.tier AS tier
         ORDER BY r.tier, r.canonicalName`,
      ),
      neo4jQuery<SectionRow>(
        `MATCH (p:Person {slug: $slug})-[:HAS_CONTENT]->(d:Description)
         OPTIONAL MATCH (d)-[:SOURCED_FROM]->(from:Source)
         WITH d, from
           ORDER BY coalesce(d.order, 1)
         OPTIONAL MATCH (d)-[cites:CITES]->(src:Source)
         WITH d, from, collect(CASE WHEN src IS NULL THEN NULL ELSE {
           inline:       coalesce(cites.inline, false),
           sourceId:     src.id,
           sourceTitle:  src.title,
           sourceUrl:    src.url,
           sourceAuthor: src.authorFreeText
         } END) AS rawCites
         RETURN coalesce(d.order, 1) AS order, d.content AS content,
                [x IN rawCites WHERE x IS NOT NULL] AS citations,
                CASE WHEN from IS NULL THEN NULL ELSE {
                  id:             from.id,
                  title:          from.title,
                  url:            from.url,
                  authorFreeText: from.authorFreeText,
                  license:        from.license,
                  attribution:    from.attribution
                } END AS sourcedFrom
         ORDER BY order`,
        { slug },
      ),
    ])
    heroImage.value = heroRows[0] ?? null
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
    externalRefs.value = refRows
    membershipEntries.value = memberEntries
    membershipTargets.value = memberTargets
    attendanceEntries.value = attendEntries
    attendanceTargets.value = attendTargets
    incidentEntries.value   = incidEntries
    incidentTargets.value   = incidTargets
    operationEntries.value  = operEntries
    operationTargets.value  = operTargets
    heldRanks.value = rankRows
    allRanks.value = allRankRows
    sectionOriginal.value = sectionRows.map(rowToSection)
    sectionDraft.value    = sectionOriginal.value.map(cloneSection)
    neo4jPerson.value = personRows[0] ?? null
  } catch (err) {
    console.error('PersonDetail hero/gallery fetch error:', err)
  }
}


// Merged view: Neo4j is authoritative for existence and core identity;
// IDB cache layers on rich extras (description, locations, stations, movie,
// outlines, events, gallery, thumbnailUrl) for persons that were in the
// Sanity dump. If a person isn't in IDB (the former "auto-" case), those
// extras are simply absent and the corresponding sections render empty.
const person = computed(() => {
  const core = neo4jPerson.value
  if (!core) return null
  const extras = people.value.find(p => p.slug === core.slug)
  // In edit mode, overlay the (possibly unsaved) form values so the
  // Forhåndsvisning tab reflects the edit in real time.
  const overlay = editDirty.value ? {
    name:       editForm.value.canonicalName,
    secretName: editForm.value.secretName.trim() || null,
    home:       editForm.value.home.trim() || null,
    birthYear:  parseEditedBirthYear(),
    type:       editForm.value.type,
  } : {}
  return { ...(extras ?? {}), ...core, ...overlay }
})

function parseEditedBirthYear(): number | null {
  const trimmed = editForm.value.birthYear.trim()
  if (!trimmed) return null
  const n = Number(trimmed)
  return Number.isInteger(n) ? n : null
}


const personTitle = computed(() => {
  if (!person.value) return ''
  let t = person.value.name
  if (person.value.secretName) t += ` (${person.value.secretName})`
  if (person.value.birthYear) t += ` - født i ${person.value.birthYear}`
  return t
})

const MONTHS = ['januar','februar','mars','april','mai','juni','juli','august','september','oktober','november','desember']

function formatDate(iso?: string): string {
  if (!iso) return '–'
  const [y, m, d] = iso.split('-').map(Number)
  return `${d}. ${MONTHS[m - 1]} ${y}`
}

function eventTags(event: IdbEvent): string[] {
  return [...new Set([event.organization, event.district].filter(Boolean) as string[])]
}

const eventSortAsc = ref(true)

const sortedEvents = computed(() => {
  const evts = [...(person.value?.events ?? [])]
  return eventSortAsc.value
    ? evts.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
    : evts.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
})

const outlines = computed(() => person.value?.outlines ?? [])

const heroUrl = computed<string | null>(() => {
  const url = heroImage.value?.url
  if (!url) return null
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}w=900&h=500&fit=crop&auto=format`
})

const personInitials = computed<string>(() => {
  const name = person.value?.name ?? ''
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  const first = parts[0]?.[0] ?? ''
  const last  = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : ''
  return (first + last).toUpperCase()
})

</script>

<style scoped>
.edit-pane {
  background: var(--paper-raised);
  border-bottom: 1px solid var(--rule);
  padding: 20px 24px;
}

.edit-section + .edit-section { margin-top: 24px; }

.edit-section-heading {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
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
  color: var(--ink);
}

.edit-input {
  width: 100%;
  padding: 8px 10px;
  font-size: 14px;
  color: var(--ink);
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: 4px;
  box-sizing: border-box;
  font-family: var(--font-sans);
}
.edit-input:focus {
  outline: 2px solid var(--focus);
  outline-offset: -1px;
  border-color: var(--focus);
}
.edit-input-narrow { max-width: 140px; }

.edit-save-bar {
  margin-top: 20px;
  padding: 10px 14px;
  background: var(--paper-sunken);
  border: 1px solid var(--rule);
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.edit-save-prompt { flex: 1; font-size: 13px; color: var(--ink-soft); font-weight: 600; }
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
  font-size: 12px;
  color: var(--ink-soft);
  text-decoration: underline;
  cursor: pointer;
}
.edit-link-revert:disabled { opacity: 0.5; cursor: not-allowed; }

.edit-save-error {
  margin-top: 8px;
  padding: 8px 10px;
  background: var(--paper-sunken);
  border: 1px solid var(--danger);
  border-radius: 6px;
  font-size: 12px;
  color: var(--danger);
}

@media (max-width: 520px) {
  .edit-row { grid-template-columns: 1fr; gap: 4px; }
}

/* Sivil / Soldat segmented control */
.type-seg {
  display: inline-flex;
  gap: 0;
  border: 1px solid var(--rule);
  border-radius: 4px;
  overflow: hidden;
}

.type-seg-opt {
  display: inline-flex;
  align-items: center;
  padding: 6px 14px;
  font-size: 13px;
  color: var(--muted);
  cursor: pointer;
  user-select: none;
}

.type-seg-opt + .type-seg-opt { border-left: 1px solid var(--rule); }

.type-seg-opt input[type="radio"] {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.type-seg-opt.active {
  background: var(--ink);
  color: var(--paper);
  font-weight: 500;
}

/* ── Rangering (preview) ─────────────────────────────────────── */
.rank-list {
  list-style: none;
  padding: 0;
  margin: 8px 0 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.rank-row {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 2px 10px;
  font-size: 12px;
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: 12px;
  color: var(--ink);
}

.rank-name   { font-weight: 600; }
.rank-period { font-size: 11px; color: var(--muted); font-family: var(--font-mono); }

/* ── Rangering (edit) ────────────────────────────────────────── */
.edit-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}

.edit-btn-outline {
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 600;
  background: transparent;
  color: var(--focus);
  border: 1px solid var(--rule);
  border-radius: 4px;
  cursor: pointer;
}
.edit-btn-outline:hover { border-color: var(--focus); }

.edit-empty {
  padding: 12px;
  text-align: center;
  font-size: 12px;
  font-style: italic;
  color: var(--muted);
  border: 1px dashed var(--rule);
  border-radius: 6px;
}

.rank-edit-row {
  display: grid;
  grid-template-columns: 1fr 80px auto 80px 28px;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}

.rank-edit-select { min-width: 0; }

.edit-input-year {
  text-align: center;
  font-family: var(--font-mono);
}

.rank-dash { text-align: center; color: var(--muted); }

.rank-remove-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  font-size: 12px;
  color: var(--danger);
  background: transparent;
  border: 1px solid var(--rule);
  border-radius: 4px;
  cursor: pointer;
}
.rank-remove-btn:hover { background: var(--paper-sunken); border-color: var(--danger); }

/* ── Medlemskap (edit) ────────────────────────────────────────── */
.membership-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.membership-item {
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: 6px;
}

.membership-item.expanded { border-color: var(--focus); }

.membership-summary {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  font-family: var(--font-sans);
}

.membership-unit-name { font-weight: 600; color: var(--ink); }

.membership-meta {
  flex: 1;
  font-size: 12px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.membership-chevron {
  font-size: 12px;
  color: var(--muted);
  flex-shrink: 0;
}

.membership-body {
  padding: 0 12px 12px;
  border-top: 1px dashed var(--rule);
}

.membership-body > * + * { margin-top: 8px; }

.membership-desc-wrap { display: flex; flex-direction: column; gap: 4px; }
.membership-desc-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
}

/* ── Membership info popup ──────────────────────────────────── */
.popup-scrim {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 200;
}

.popup-card {
  max-width: 560px;
  width: 100%;
  max-height: 85vh;
  overflow-y: auto;
  background: var(--paper-raised);
  border-radius: 8px;
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.3);
  padding: 20px 24px;
}

.popup-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}

.popup-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--focus);
  margin: 0;
}

.popup-close {
  width: 28px;
  height: 28px;
  padding: 0;
  font-size: 14px;
  background: transparent;
  border: 1px solid var(--rule);
  border-radius: 50%;
  cursor: pointer;
  color: var(--muted);
}
.popup-close:hover { border-color: var(--focus); color: var(--focus); }

.popup-sub {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
  font-size: 12px;
  color: var(--muted);
}

.popup-body {
  font-size: 14px;
  line-height: 1.6;
  color: var(--ink);
}
.popup-body :deep(p) { margin: 0 0 0.75em; }
.popup-body :deep(p:last-child) { margin-bottom: 0; }
.popup-body :deep(a) { color: var(--focus); text-decoration: underline; }

.edit-input-invalid {
  border-color: var(--danger);
  background: var(--paper-sunken);
}

.unit-picker {
  position: relative;
  min-width: 0;
}

.unit-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 6px 6px 12px;
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: 14px;
  font-size: 13px;
  color: var(--focus);
}
.unit-chip-name { font-weight: 600; }
.unit-chip-clear {
  width: 20px;
  height: 20px;
  padding: 0;
  font-size: 10px;
  color: var(--muted);
  background: transparent;
  border: none;
  border-radius: 50%;
  cursor: pointer;
}
.unit-chip-clear:hover { background: var(--paper); color: var(--danger); }

.unit-results {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 240px;
  overflow-y: auto;
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  z-index: 10;
}

.unit-result {
  display: block;
  width: 100%;
  padding: 7px 10px;
  font-size: 13px;
  color: var(--ink);
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--rule);
  cursor: pointer;
  text-align: left;
  font-family: var(--font-sans);
}
.unit-result:last-child { border-bottom: none; }
.unit-result:hover      { background: var(--paper); }

.membership-edit-top {
  display: grid;
  grid-template-columns: 1fr 160px 28px;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}

.attendance-edit-top {
  display: grid;
  grid-template-columns: 1fr 28px;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}

.membership-edit-dates {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}

.edit-input-date {
  font-family: var(--font-mono);
  font-size: 12px;
}

.membership-desc {
  resize: vertical;
  font-family: var(--font-sans);
}

/* ── Beskrivelse (preview) ───────────────────────────────────── */
.section-wrap { position: relative; }

.is-quote {
  border-left: 3px solid var(--rule);
  padding: 2px 14px;
  margin: 12px 0 12px 2px;
  font-style: italic;
  color: var(--ink);
}

.sourced-from {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  margin: -6px 0 12px 18px;
  font-size: 11px;
  color: var(--muted);
}
.sourced-label  { font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; font-size: 10px; }
.sourced-link   { color: var(--focus); text-decoration: underline; }
.sourced-license {
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 1px 6px;
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: 8px;
  color: var(--muted);
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
  color: var(--focus);
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: 12px;
  text-decoration: none;
}
.cite-chip:hover       { border-color: var(--focus); }
.cite-chip-author      { color: var(--muted); }
.cite-chip-arrow       { font-size: 10px; opacity: 0.6; }

.section-footnotes {
  position: absolute;
  right: 0;
  bottom: 0;
  display: flex;
  gap: 2px;
  font-size: 11px;
  color: var(--muted);
}

.card-kilder {
  border-top: 1px solid var(--rule);
  margin-top: 12px;
  padding-top: 10px;
}
.kilder-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 6px;
}
.kilder-list {
  margin: 0;
  padding-left: 22px;
  font-size: 11px;
  color: var(--muted);
  line-height: 1.5;
}
.kilder-list li        { margin-bottom: 3px; }
.kilder-ref            { color: inherit; text-decoration: none; }
.kilder-list a.kilder-ref { color: var(--focus); text-decoration: underline; }
.kilder-list a.kilder-ref .kilder-author { color: var(--muted); }
.kilder-arrow { font-size: 10px; opacity: 0.6; color: var(--focus); }

/* ── Hero ───────────────────────────────────────────────────── */
.hero {
  width: 100%;
  height: 280px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.hero-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center 20%;
  display: block;
}

.hero--empty {
  background: linear-gradient(135deg, var(--paper-raised) 0%, var(--paper) 100%);
  border-bottom: 1px solid var(--rule);
}

.hero-placeholder {
  font-size: 72px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--rule);
  font-variant: all-small-caps;
  user-select: none;
}

@media (max-width: 480px) {
  .hero { height: 200px; }
  .hero-placeholder { font-size: 56px; }
}

/* ── Page header ────────────────────────────────────────────── */
.page-header {
  padding: 14px 16px 12px;
  background: var(--paper-raised);
  border-bottom: 1px solid var(--rule);
}

.back-link {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  font-size: 13px;
  font-weight: 600;
  color: var(--focus);
  text-decoration: none;
  margin-bottom: 6px;
}
.back-link:hover { text-decoration: underline; }

.person-name {
  font-family: var(--font-serif);
  font-size: var(--size-display);
  font-weight: 600;
  color: var(--ink);
  margin: 0 0 var(--space-xs);
  line-height: var(--leading-tight);
  letter-spacing: var(--tracking-tight);
  overflow-wrap: break-word;
}

.person-meta {
  font-size: 12px;
  color: var(--muted);
  margin: 0;
}

/* ── Sections ───────────────────────────────────────────────── */
.section {
  padding: 12px 16px;
  border-bottom: 1px solid var(--rule);
  background: var(--paper-raised);
}

.section + .section {
  border-top: none;
}

.section:last-of-type {
  margin-bottom: 48px;
}

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
  color: var(--muted);
  margin: 0;
}

.sort-btn {
  background: none;
  border: 1px solid var(--rule);
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  padding: 6px 10px;
  cursor: pointer;
  white-space: nowrap;
  touch-action: manipulation;
}
.sort-btn:hover { border-color: var(--focus); color: var(--focus); }

/* ── Description ────────────────────────────────────────────── */
.plain-text {
  font-size: 14px;
  line-height: 1.75;
  color: var(--ink);
  margin: 0;
  white-space: pre-line;
}

.rich-text {
  font-size: 14px;
  line-height: 1.75;
  color: var(--ink);
}
.rich-text :deep(p)          { margin: 0 0 0.75em; }
.rich-text :deep(p:last-child) { margin-bottom: 0; }
.rich-text :deep(h1),
.rich-text :deep(h2),
.rich-text :deep(h3),
.rich-text :deep(h4)         { font-weight: 700; margin: 1em 0 0.4em; color: var(--ink); }
.rich-text :deep(h2)         { font-size: 16px; }
.rich-text :deep(h3)         { font-size: 14px; }
.rich-text :deep(ul),
.rich-text :deep(ol)         { padding-left: 1.4em; margin: 0.5em 0; }
.rich-text :deep(li)         { margin: 0.2em 0; }
.rich-text :deep(strong)     { font-weight: 700; }
.rich-text :deep(em)         { font-style: italic; }
.rich-text :deep(blockquote) { border-left: 3px solid var(--rule); margin: 0.75em 0; padding-left: 12px; color: var(--muted); font-style: italic; }
.rich-text :deep(a.internal-link),
.rich-text :deep(a.external-link) { color: var(--focus); text-decoration: underline; }
.rich-text :deep(code)       { font-family: var(--font-mono); font-size: 0.9em; background: var(--rule); padding: 1px 4px; border-radius: 3px; }

/* ── Link list ──────────────────────────────────────────────── */
.link-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.section-link {
  display: block;
  font-size: 13px;
  color: var(--focus);
  text-decoration: none;
  padding: 2px 0;
}
.section-link:hover { text-decoration: underline; }

/* ── Event items ────────────────────────────────────────────── */
.event-item {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 10px;
  padding: 8px 8px;
  margin: 0 -8px;
  text-decoration: none;
  color: var(--ink);
  border-bottom: 1px solid var(--rule);
  border-radius: 4px;
  transition: background 0.1s;
}
.event-item:last-child { border-bottom: none; }
.event-item:hover { background: var(--paper); }
.event-item:hover .event-title { text-decoration: underline; }

.event-date {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  flex-shrink: 0;
}

.event-title {
  font-size: 13px;
  color: var(--focus);
  flex: 1;
  min-width: 0;
}

.event-tags {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
  margin-left: auto;
}

@media (max-width: 480px) {
  .event-tags {
    width: 100%;
    justify-content: flex-start;
    margin-left: 0;
  }
}

.event-tag {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: 3px;
  padding: 1px 5px;
  white-space: nowrap;
}

/* ── External links ─────────────────────────────────────────── */
/* ── Relation rows (MEMBER_OF edges with metadata) ──────────── */
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
  color: var(--focus);
  text-decoration: none;
}
.relation-link:hover { text-decoration: underline; }

.relation-role {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
  padding: 1px 6px;
  border: 1px solid var(--rule);
  border-radius: 3px;
}

.member-period {
  font-size: 11px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.info-marker {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid var(--rule);
  background: var(--paper-raised);
  color: var(--muted);
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
  background: var(--faded-red);
  border-color: var(--faded-red);
  color: var(--paper);
}

.relation-desc {
  flex-basis: 100%;
  margin: 4px 0 2px;
  padding: 8px 10px;
  background: var(--paper);
  border-left: 3px solid var(--focus);
  border-radius: 0 3px 3px 0;
}
.relation-desc-text {
  margin: 0 0 4px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--ink);
}
.relation-desc-text:last-child { margin-bottom: 0; }

/* ── Lenker (Neo4j REFERENCED_IN) ────────────────────────────── */
.ref-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  margin: 0 -8px;
  text-decoration: none;
  color: var(--ink);
  border-radius: 4px;
  transition: background 0.1s;
}
.ref-item:hover { background: var(--paper); }
.ref-item:hover .ref-title { text-decoration: underline; }

.ref-title {
  font-size: 13px;
  color: var(--focus);
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
  font-size: 11px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.section-empty {
  margin: 0;
  padding: 4px 0;
  font-size: 12px;
  color: var(--muted);
  font-style: italic;
}

/* ── Legacy Sanity links (kept until the "Original" tab is fully retired) ── */
.ext-link {
  display: block;
  font-size: 13px;
  color: var(--focus);
  text-decoration: none;
  padding: 2px 0;
  word-break: break-all;
}
.ext-link:hover { text-decoration: underline; }
.ext-icon { font-size: 11px; opacity: 0.6; }

/* ── Video ──────────────────────────────────────────────────── */
.video-player {
  width: 100%;
  border-radius: 4px;
  display: block;
}

/* ── Carousel ───────────────────────────────────────────────── */
.carousel {
  display: flex;
  align-items: center;
  gap: 8px;
}

.carousel-img {
  flex: 1;
  width: 100%;
  max-height: 320px;
  object-fit: contain;
  display: block;
  border-radius: 4px;
  background: var(--rule);
}

.carousel-btn {
  background: none;
  border: 1px solid var(--rule);
  border-radius: 50%;
  width: 44px;
  height: 44px;
  font-size: 22px;
  color: var(--focus);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  line-height: 1;
  touch-action: manipulation;
}
.carousel-btn:hover { border-color: var(--rule); }

.carousel-count {
  font-size: 11px;
  color: var(--muted);
  text-align: center;
  margin: 6px 0 0;
}

.carousel-caption {
  font-size: 12px;
  color: var(--muted);
  text-align: center;
  margin: 4px 0 0;
  font-style: italic;
}
</style>
