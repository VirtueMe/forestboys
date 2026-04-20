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
      </div>

      <!-- Beskrivelse -->
      <section v-if="person.descriptionHtml || person.description" class="section">
        <h3 class="section-heading">Beskrivelse</h3>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div v-if="person.descriptionHtml" class="rich-text" itemprop="description" v-html="person.descriptionHtml"></div>
        <p v-else class="plain-text">{{ person.description }}</p>
      </section>

      <!-- Medlemskap (MEMBER_OF units with role / period / info marker) -->
      <section v-if="memberships.length" class="section">
        <h3 class="section-heading">Medlemskap ({{ memberships.length }})</h3>
        <div class="relation-list">
          <div v-for="m in memberships" :key="m.unitSlug" class="relation-row">
            <RouterLink :to="`/district/${m.unitSlug}`" class="relation-link">{{ m.unitName }}</RouterLink>
            <span v-if="m.role" class="relation-role">{{ ROLE_LABEL[m.role] ?? m.role }}</span>
            <span v-if="membershipPeriod(m)" class="member-period">{{ membershipPeriod(m) }}</span>
            <button
              v-if="m.description"
              class="info-marker"
              type="button"
              :aria-expanded="expandedMembership === m.unitSlug"
              aria-label="Vis forklaring"
              @click="toggleMembership(m.unitSlug)"
            >
              i
            </button>
            <div v-if="m.description && expandedMembership === m.unitSlug" class="relation-desc">
              <p class="relation-desc-text">{{ m.description }}</p>
              <SourceRef v-if="m.sourceRefs?.length" :refs="m.sourceRefs" />
            </div>
          </div>
        </div>
      </section>

      <!-- Hendelser -->
      <section v-if="person.events?.length" class="section">
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
import { ref, computed, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useLocationCache } from '../composables/useLocationCache.ts'
import { neo4jQuery } from '../composables/useNeo4j.ts'
import type { IdbEvent } from '../types/idb.ts'
import DetailPage from '../components/DetailPage.vue'
import ImageSlider, { type SlideImage } from '../components/ImageSlider.vue'
import SourceRef from '../components/SourceRef.vue'
import AdminViewTabs, { type AdminViewMode } from '../components/AdminViewTabs.vue'
import { authFetch } from '../composables/useAuth.ts'

const { people, init } = useLocationCache()

const mode = ref<AdminViewMode>('preview')

interface Neo4jPerson {
  slug: string
  name: string
  secretName: string | null
  home: string | null
  birthYear: number | null
  status: string | null
  serviceClass: string | null
}
const neo4jPerson = ref<Neo4jPerson | null>(null)

// ── Grunnleggende edit form (admin) ────────────────────────────────────
interface EditForm {
  canonicalName: string
  secretName:    string
  birthYear:     string // input value; parsed to int on save
  home:          string
}

const editForm     = ref<EditForm>({ canonicalName: '', secretName: '', birthYear: '', home: '' })
const editOriginal = ref<EditForm>({ canonicalName: '', secretName: '', birthYear: '', home: '' })
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
      canonicalName?: string; secretName?: string | null; birthYear?: number | null; home?: string | null; error?: string
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

interface Membership {
  unitSlug: string
  unitName: string
  role: string | null
  description: string | null
  sourceRefs: string[] | null
  startDate: string | null
  endDate: string | null
}
const memberships = ref<Membership[]>([])
const expandedMembership = ref<string | null>(null)
function toggleMembership(s: string) {
  expandedMembership.value = expandedMembership.value === s ? null : s
}
function membershipPeriod(m: Membership): string | null {
  if (!m.startDate && !m.endDate) return null
  return `${m.startDate ?? '?'}${m.endDate ? ` – ${m.endDate}` : ''}`
}
const ROLE_LABEL: Record<string, string> = {
  administrative: 'administrativt',
  operational:    'operativt',
  sponsor:        'sponsor',
  parent:         'overordnet',
  operative:      'operatør',
  courier:        'kurér',
  radiotelegraph: 'radiotelegrafist',
  host:           'vert',
  informant:      'informant',
  member:         'medlem',
}

function resetPerson() {
  neo4jPerson.value   = null
  heroImage.value     = null
  galleryImages.value = []
  externalRefs.value  = []
  memberships.value   = []
  expandedMembership.value = null
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
    const [personRows, heroRows, galleryRows, refRows, membershipRows] = await Promise.all([
      neo4jQuery<Neo4jPerson>(
        `MATCH (p:Person {slug: $slug})
         RETURN p.slug AS slug, p.canonicalName AS name,
                p.secretName AS secretName, p.home AS home,
                p.birthYear AS birthYear, p.status AS status,
                p.serviceClass AS serviceClass`,
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
      // Memberships — direct MEMBER_OF edges with role / dates / description
      // / sourceRefs metadata. Same info-marker pattern as PART_OF: rows with
      // a description sort LAST.
      neo4jQuery<Membership>(
        `MATCH (p:Person {slug: $slug})-[m:MEMBER_OF]->(u:Unit)
         RETURN u.slug AS unitSlug, u.canonicalName AS unitName,
                m.role AS role, m.description AS description,
                m.sourceRefs AS sourceRefs,
                m.startDate AS startDate, m.endDate AS endDate
         ORDER BY CASE WHEN m.description IS NOT NULL THEN 1 ELSE 0 END,
                  m.startDate, unitName`,
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
    memberships.value = membershipRows
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
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  padding: 20px 24px;
}

.edit-section + .edit-section { margin-top: 24px; }

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
.edit-input-narrow { max-width: 140px; }

.edit-save-bar {
  margin-top: 20px;
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

@media (max-width: 520px) {
  .edit-row { grid-template-columns: 1fr; gap: 4px; }
}

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
  background: linear-gradient(135deg, var(--color-surface) 0%, var(--color-bg) 100%);
  border-bottom: 1px solid var(--color-border);
}

.hero-placeholder {
  font-size: 72px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--color-border-mid);
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

.person-name {
  font-size: 22px;
  font-weight: 700;
  color: var(--color-text);
  margin: 0 0 4px;
  line-height: 1.25;
  overflow-wrap: break-word;
}

.person-meta {
  font-size: 12px;
  color: var(--color-muted);
  margin: 0;
}

/* ── Sections ───────────────────────────────────────────────── */
.section {
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
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

.rich-text {
  font-size: 14px;
  line-height: 1.75;
  color: var(--color-text);
}
.rich-text :deep(p)          { margin: 0 0 0.75em; }
.rich-text :deep(p:last-child) { margin-bottom: 0; }
.rich-text :deep(h1),
.rich-text :deep(h2),
.rich-text :deep(h3),
.rich-text :deep(h4)         { font-weight: 700; margin: 1em 0 0.4em; color: var(--color-text); }
.rich-text :deep(h2)         { font-size: 16px; }
.rich-text :deep(h3)         { font-size: 14px; }
.rich-text :deep(ul),
.rich-text :deep(ol)         { padding-left: 1.4em; margin: 0.5em 0; }
.rich-text :deep(li)         { margin: 0.2em 0; }
.rich-text :deep(strong)     { font-weight: 700; }
.rich-text :deep(em)         { font-style: italic; }
.rich-text :deep(blockquote) { border-left: 3px solid var(--color-border-mid); margin: 0.75em 0; padding-left: 12px; color: var(--color-muted); font-style: italic; }
.rich-text :deep(a.internal-link),
.rich-text :deep(a.external-link) { color: var(--color-navy); text-decoration: underline; }
.rich-text :deep(code)       { font-family: monospace; font-size: 0.9em; background: var(--color-border); padding: 1px 4px; border-radius: 3px; }

/* ── Link list ──────────────────────────────────────────────── */
.link-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.section-link {
  display: block;
  font-size: 13px;
  color: var(--color-navy);
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
  color: var(--color-muted);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
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

.member-period {
  font-size: 11px;
  color: var(--color-muted);
  font-variant-numeric: tabular-nums;
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

/* ── Lenker (Neo4j REFERENCED_IN) ────────────────────────────── */
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

.section-empty {
  margin: 0;
  padding: 4px 0;
  font-size: 12px;
  color: var(--color-muted);
  font-style: italic;
}

/* ── Legacy Sanity links (kept until the "Original" tab is fully retired) ── */
.ext-link {
  display: block;
  font-size: 13px;
  color: var(--color-navy);
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
  background: var(--color-border);
}

.carousel-btn {
  background: none;
  border: 1px solid var(--color-border);
  border-radius: 50%;
  width: 44px;
  height: 44px;
  font-size: 22px;
  color: var(--color-navy);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  line-height: 1;
  touch-action: manipulation;
}
.carousel-btn:hover { border-color: var(--color-border-mid); }

.carousel-count {
  font-size: 11px;
  color: var(--color-muted);
  text-align: center;
  margin: 6px 0 0;
}

.carousel-caption {
  font-size: 12px;
  color: var(--color-muted);
  text-align: center;
  margin: 4px 0 0;
  font-style: italic;
}
</style>
