<template>
  <DetailPage
    :load="loadPerson"
    :reset="resetPerson"
    :not-found="!person && !isAutoSlug"
    not-found-text="Person ikke funnet."
    page-class="person-page"
  >
    <div itemscope itemtype="https://schema.org/Person">
      <!-- Auto-generated stub (not in Sanity) -->
      <template v-if="isAutoSlug">
        <div class="page-header">
          <RouterLink to="/registre" class="back-link">&#x2039; Tilbake</RouterLink>
          <div class="person-name-row">
            <h1 class="person-name">{{ autoPersonName || route.params.slug }}</h1>
            <span class="auto-badge">Autogenerert</span>
          </div>
          <p class="person-meta">Ikke registrert i kildebasen ennå.</p>
        </div>
        <EnrichedPerson
          :slug="route.params.slug as string"
          :gallery="[]"
          :links="[]"
          @select-event-slug="s => router.push(`/events/${s}`)"
        />
      </template>

      <template v-else>
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

        <AppTabs v-model="activeTab" :tabs="TABS">
          <!-- ── Original (Sanity) ──────────────────────────────── -->
          <template v-if="activeTab === 'original'">
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
          </template>

          <!-- ── Enriched (Neo4j) ───────────────────────────────── -->
          <EnrichedPerson
            v-else
            :slug="person.slug"
            :gallery="person.gallery"
            :links="person.links"
            @select-event-slug="slug => router.push(`/events/${slug}`)"
            @has-data="v => (enrichedHasData = v)"
          />
        </AppTabs>
      </template>
    </div>
  </DetailPage>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { useLocationCache } from '../composables/useLocationCache.ts'
import { neo4jQuery } from '../composables/useNeo4j.ts'
import type { IdbEvent } from '../types/idb.ts'
import AppTabs from '../components/AppTabs.vue'
import DetailPage from '../components/DetailPage.vue'
import EnrichedPerson from '../components/EnrichedPerson.vue'
import ImageSlider, { type SlideImage } from '../components/ImageSlider.vue'
import SourceRef from '../components/SourceRef.vue'

const route  = useRoute()
const router = useRouter()
const { people, loading, init } = useLocationCache()

const isAutoSlug = computed(() => (route.params.slug as string).startsWith('auto-'))
const autoPersonName = ref<string | null>(null)

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
  heroImage.value     = null
  galleryImages.value = []
  externalRefs.value  = []
  memberships.value   = []
  autoPersonName.value = null
  expandedMembership.value = null
}

async function loadPerson(slug: string) {
  await init()
  if (isAutoSlug.value) {
    try {
      const rows = await neo4jQuery<{ name: string }>(
        `MATCH (p:Person {slug: $slug}) RETURN p.name AS name LIMIT 1`,
        { slug },
      )
      autoPersonName.value = rows[0]?.name ?? null
    } catch {
      autoPersonName.value = null
    }
    return
  }

  // Hero + gallery (Neo4j-direct). Hero selection rule:
  //   1. Direct HAS_IMAGE with isHero = true
  //   2. Else direct Source with kind = 'portrait'
  //   3. Else first direct image by order (Sanity convention: gallery[0] ≈ portrait)
  try {
    const [heroRows, galleryRows, refRows, membershipRows] = await Promise.all([
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
  } catch (err) {
    console.error('PersonDetail hero/gallery fetch error:', err)
  }
}


const person = computed(() =>
  isAutoSlug.value
    ? null
    : (people.value.find(p => p.slug === (route.params.slug as string)) ?? null),
)

// Tabs
const activeTab       = ref('original')
const enrichedHasData = ref<boolean | null>(null)

const TABS = computed(() => [
  { id: 'original', label: 'Original' },
  { id: 'enriched', label: 'Beriket', disabled: enrichedHasData.value === false },
])

async function checkEnrichedData(slug: string) {
  enrichedHasData.value = null
  try {
    const rows = await neo4jQuery<{ n: number }>(
      `MATCH (p:Person {slug: $slug})<-[:INVOLVED]-() RETURN count(*) AS n LIMIT 1`,
      { slug },
    )
    enrichedHasData.value = (rows[0]?.n ?? 0) > 0
  } catch {
    enrichedHasData.value = false
  }
}

watch(
  () => person.value?.slug,
  slug => {
    activeTab.value = route.hash === '#beriket' ? 'enriched' : 'original'
    if (slug) void checkEnrichedData(slug)
  },
  { immediate: true },
)


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

.person-name-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}

.auto-badge {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #7a4f00;
  background: #fff3cd;
  border: 1px solid #f0c040;
  border-radius: 3px;
  padding: 2px 7px;
  white-space: nowrap;
  flex-shrink: 0;
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
