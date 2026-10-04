<template>
  <DetailPage
    :load="loadPerson"
    :reset="resetPerson"
    :not-found="!person"
    not-found-text="Person ikke funnet."
    page-class="person-page"
  >
    <div v-if="person && neo4jPerson" itemscope itemtype="https://schema.org/Person">
      <!-- Identity strip — header + ranks preview overlay the in-progress
           scalar draft via PersonScalarEditor.defineExpose, so they
           render meaningfully even on /person/new. -->
      <DetailHero :image-url="heroUrl" :alt="person.name" :placeholder="personInitials" itemprop="image" />
      <PersonHeader
        :title="personTitle"
        :secret-name="person.secretName"
        :birth-year="person.birthYear ?? null"
        :home="person.home"
      />
      <PersonRanksPreview v-if="person.type === 'soldier'" :known="knownRank" :history="rankHistory" />

      <AdminViewTabs v-model="mode" :proposal-count="bundlesPanel.openBundles.value.length" />

      <template v-if="mode === 'proposals' && bundlesPanel.currentBundle.value">
        <BundleReviewPanel
          :key="bundlesPanel.currentBundle.value.bundleId"
          :bundle-id="bundlesPanel.currentBundle.value.bundleId"
          :older-bundle="bundlesPanel.olderBundle.value"
          :newer-bundle="bundlesPanel.newerBundle.value"
          @deleted="bundlesPanel.onBundleDeleted"
          @navigate="bundlesPanel.onBundleNavigate"
        />
      </template>

      <PersonEditPane
        v-show="mode === 'edit'"
        ref="editPane"
        :person="neo4jPerson"
        :known-rank="knownRank"
        :rank-history="rankHistory"
        :rank-options="allRanks"
        :saved-sections="savedSections"
        :data="relationsData"
        :pending-expand-event="pendingExpandEvent"
        :create-mode="isCreate"
        :pending-description="pendingDescription"
        :create-event-href="createEventHref"
        @saved-scalar="onScalarSaved"
        @saved-rank="rank => knownRank = rank"
        @saved-sections="onSectionsSaved"
        @created="onCreated"
      />

      <PersonViewPane
        v-show="mode === 'preview'"
        :person="person"
        :preview-sections="previewSections"
        :relations="relationsData"
        :outlines="outlines"
        :show-legacy-events="!incidentEntries.length"
        :gallery-images="galleryImages"
        :external-refs="externalRefs"
      />
    </div>
  </DetailPage>
</template>

<script setup lang="ts">
import { ref, computed, watch, useTemplateRef, inject } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useLocationCache } from '../composables/useLocationCache.ts'
import { usePersonData } from '../composables/usePersonData.ts'
import { PersonDataKey } from '../composables/proposalDataInjection.ts'
import { useDetailCreateMode } from '../composables/useDetailCreateMode.ts'
import DetailPage from '../components/DetailPage.vue'
import AdminViewTabs from '../components/AdminViewTabs.vue'
import BundleReviewPanel from '../components/BundleReviewPanel.vue'
import { useAuth } from '../composables/useAuth.ts'
import { useEntityBundles } from '../composables/useEntityBundles.ts'
import type { Section } from '../components/SectionsEditor.vue'
import type { ScalarDraft } from '../components/person/PersonScalarEditor.vue'
import DetailHero          from '../components/DetailHero.vue'
import PersonHeader        from '../components/person/PersonHeader.vue'
import PersonRanksPreview  from '../components/person/PersonRanksPreview.vue'
import PersonEditPane      from '../components/person/PersonEditPane.vue'
import PersonViewPane      from '../components/person/PersonViewPane.vue'

const { people } = useLocationCache()

const route  = useRoute()
const router = useRouter()

// Data layer: live by default, swappable to a proposal-wrapped composable
// when a parent provides PersonDataKey (see AdminProposalEntityPreview).
const {
  neo4jPerson,
  heroImage, galleryImages, externalRefs,
  knownRank, rankHistory, allRanks, savedSections,
  incidentEntries,
  relationsData,
  loadPerson, resetPerson,
} = inject(PersonDataKey, () => usePersonData(), true)

const { isCreate, mode, pendingDescription, onCreated, clearPending } =
  useDetailCreateMode({ kind: 'person', pathPrefix: '/person' })

const { user } = useAuth()
const isAdminPerson = computed(() => user.value?.role === 'admin')
const personSlug    = computed(() => neo4jPerson.value?.slug ?? null)
const bundlesPanel = useEntityBundles({
  kind:    'Person',
  slug:    personSlug,
  isAdmin: isAdminPerson,
})
bundlesPanel.focusOnHash(mode)

function onSectionsSaved(sections: Section[]) {
  savedSections.value = sections
  clearPending()
}

/** Captures ?expandEvent=... from the router once so the editor can latch
 *  onto it even after we strip the query param. */
const pendingExpandEvent = ref<string | null>(null)

function createEventHref(kind: 'incident' | 'operation'): string {
  const slug = neo4jPerson.value?.slug ?? ''
  const q = new URLSearchParams({ kind, forPerson: slug, returnTo: `/person/${slug}` })
  return `/events/new?${q.toString()}#new`
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

// PersonEditPane owns the two editors; we read their unsaved drafts via
// the exposed getters so the view pane can overlay them live in the
// Forhåndsvisning tab.
const editPane = useTemplateRef<{
  scalarDraft: ScalarDraft | null
  scalarDirty: boolean
  descDraft:   Section[]
  descDirty:   boolean
} | null>('editPane')

function onScalarSaved(out: {
  canonicalName?: string; secretName?: string | null; birthYear?: number | null; home?: string | null; type?: 'civilian' | 'soldier'
}) {
  const p = neo4jPerson.value
  if (!p) return
  if (out.canonicalName !== undefined) p.name       = out.canonicalName
  if (out.secretName    !== undefined) p.secretName = out.secretName
  if (out.birthYear     !== undefined) p.birthYear  = out.birthYear
  if (out.home          !== undefined) p.home       = out.home
  if (out.type          !== undefined) p.type       = out.type
}

const previewSections = computed<Section[]>(() =>
  editPane.value?.descDirty ? editPane.value.descDraft : savedSections.value,
)


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
  const ep = editPane.value
  if (!ep?.scalarDirty || !ep.scalarDraft) return { ...(extras ?? {}), ...core }
  const draft = ep.scalarDraft
  const trimmedYear = draft.birthYear.trim()
  const yearNum = trimmedYear ? Number(trimmedYear) : null
  const overlay = {
    name:       draft.canonicalName,
    secretName: draft.secretName.trim() || null,
    home:       draft.home.trim() || null,
    birthYear:  yearNum != null && Number.isInteger(yearNum) ? yearNum : null,
    type:       draft.type,
  }
  return { ...(extras ?? {}), ...core, ...overlay }
})


const personTitle = computed(() => {
  if (!person.value) return ''
  return person.value.name
})


const outlines = computed(() => person.value?.outlines ?? [])

const heroUrl = computed<string | null>(() => {
  const url = heroImage.value?.url
  if (!url) return null
  const sep = url.includes('?') ? '&' : '?'
  // fit=max never upscales the source — we just cap the delivered size for
  // bandwidth. CSS object-fit: contain handles aspect-fit so portraits stay
  // sharp and aren't stretched by the wide hero band.
  return `${url}${sep}w=1440&h=720&fit=max&auto=format`
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

