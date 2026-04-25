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
      <PersonRanksPreview v-if="person.type === 'soldier'" :ranks="heldRanks" />

      <AdminViewTabs v-model="mode" />

      <PersonEditPane
        v-show="mode === 'edit'"
        ref="editPane"
        :person="neo4jPerson"
        :held-ranks="heldRanks"
        :rank-options="allRanks"
        :saved-sections="savedSections"
        :data="relationsData"
        :pending-expand-event="pendingExpandEvent"
        :create-mode="isCreate"
        :pending-description="pendingDescription"
        :create-event-href="createEventHref"
        @saved-scalar="onScalarSaved"
        @saved-ranks="ranks => heldRanks = ranks"
        @saved-sections="onSectionsSaved"
        @created="onCreated"
      />

      <PersonViewPane
        v-show="mode !== 'edit'"
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
import { ref, computed, watch, useTemplateRef, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useLocationCache } from '../composables/useLocationCache.ts'
import { usePersonData } from '../composables/usePersonData.ts'
import { consumePendingDescription, type PendingDescription } from '../composables/usePendingDescription.ts'
import DetailPage from '../components/DetailPage.vue'
import AdminViewTabs, { type AdminViewMode } from '../components/AdminViewTabs.vue'
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

// All Neo4j fetch state + load/reset live in usePersonData.
const {
  neo4jPerson,
  heroImage, galleryImages, externalRefs,
  heldRanks, allRanks, savedSections,
  incidentEntries,
  relationsData,
  loadPerson, resetPerson,
} = usePersonData()

const mode = ref<AdminViewMode>('preview')
const isCreate = computed(() => String(route.params.slug) === 'new')

// Force edit mode whenever we're on /person/new — the preview pane
// has nothing to show yet.
watch(isCreate, v => { if (v) mode.value = 'edit' }, { immediate: true })

/** A description draft from a previous create attempt that failed to
 *  PATCH /sections. Consumed once on slug change; if matched, force
 *  edit mode so the user immediately sees the recovered draft. */
const pendingDescription = ref<PendingDescription | null>(null)
watch(() => String(route.params.slug), (slug) => {
  const p = consumePendingDescription('person', slug)
  if (p) {
    pendingDescription.value = p
    mode.value = 'edit'
  }
}, { immediate: true })

function onCreated(newSlug: string) {
  void router.replace(`/person/${newSlug}`)
}

function onSectionsSaved(sections: Section[]) {
  savedSections.value = sections
  // Successful save clears any recovery banner.
  pendingDescription.value = null
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
  let t = person.value.name
  if (person.value.secretName) t += ` (${person.value.secretName})`
  if (person.value.birthYear) t += ` - født i ${person.value.birthYear}`
  return t
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

