<template>
  <div class="admin-pages">
    <nav class="tab-strip">
      <router-link
        v-for="tab in TABS"
        :key="tab.slug"
        :to="`/admin/pages/${tab.slug}`"
        class="tab"
        :class="{ active: tab.slug === activeSlug }"
      >
        {{ tab.label }}
      </router-link>
    </nav>

    <div class="editor">
      <aside class="tree">
        <div v-if="loading" class="status">Laster…</div>
        <div v-else-if="error" class="status error">Kunne ikke laste.</div>
        <template v-else>
          <div class="tree-label">Blokker</div>
          <div class="tree-cards">
            <div
              v-for="card in cards"
              :key="card.id"
              class="card-chip"
              :class="{ active: card.id === selectedId, dragging: draggingId === card.id }"
              draggable="true"
              @click="selectCard(card.id)"
              @dragstart="onDragStart(card.id, $event)"
              @dragend="onDragEnd"
              @dragover.prevent="onDragOver(card.id)"
              @drop.prevent="onDrop"
            >
              <span class="drag-handle" aria-hidden="true">⋮⋮</span>
              <span class="card-chip-title">{{ card.title || (card.kind === 'text' ? '(tekstblokk)' : '(uten tittel)') }}</span>
              <span class="card-chip-meta">{{ card.kind }} · {{ card.layout }}</span>
            </div>
            <div v-if="!cards.length" class="tree-empty">tom</div>
          </div>

          <footer v-if="dirty" class="save-footer tree-save">
            <span class="save-prompt">Ser det bra ut?</span>
            <button class="btn-primary" :disabled="saving" @click="save">
              {{ saving ? 'Lagrer…' : 'Lagre' }}
            </button>
            <button class="link-revert" :disabled="saving" @click="revert">Angre</button>
          </footer>
        </template>
      </aside>

      <section class="panes">
        <div class="pane-tabs">
          <button
            class="pane-tab"
            :class="{ active: paneView === 'preview' }"
            @click="paneView = 'preview'"
          >
            Forhåndsvisning
          </button>
          <button
            class="pane-tab"
            :class="{ active: paneView === 'edit' }"
            @click="paneView = 'edit'"
          >
            Rediger
          </button>
        </div>

        <section v-if="paneView === 'preview'" class="pane">
          <template v-if="selected">
            <div class="preview-meta">
              <span class="id-chip"><code>{{ selected.id }}</code></span>
              <span class="meta-sep">·</span>
              <span>{{ selected.kind }} · {{ selected.layout }}</span>
            </div>
            <article class="card-preview">
              <img
                v-if="selected.imageUrl"
                :src="`${selected.imageUrl}?w=700&auto=format`"
                :alt="selected.title ?? ''"
                class="preview-img"
              />
              <div class="preview-body">
                <h2 v-if="selected.title" class="preview-title">{{ selected.title }}</h2>
                <template v-for="s in [...selected.sections].sort((a, b) => a.order - b.order)" :key="s.order">
                  <div class="section-wrap">
                    <!-- eslint-disable vue/no-v-html -->
                    <div
                      class="preview-content portable-text"
                      :class="{ 'is-quote': s.citations.length > 0 || s.sourcedFrom }"
                      v-html="sectionHtml(s)"
                    ></div>
                    <!-- eslint-enable vue/no-v-html -->
                    <div v-if="s.sourcedFrom" class="sourced-from">
                      <span class="sourced-label">Fra:</span>
                      <a
                        v-if="s.sourcedFrom.url"
                        :href="s.sourcedFrom.url"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="sourced-link"
                      >{{ s.sourcedFrom.attribution || s.sourcedFrom.title || s.sourcedFrom.id }} ↗</a>
                      <span v-else class="sourced-link">{{ s.sourcedFrom.attribution || s.sourcedFrom.title || s.sourcedFrom.id }}</span>
                      <span v-if="s.sourcedFrom.license" class="sourced-license">{{ s.sourcedFrom.license }}</span>
                    </div>
                    <div v-if="inlineCites(s).length" class="inline-cites">
                      <a
                        v-for="c in inlineCites(s)"
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
                    <div v-if="footnoteCites(s, selected).length" class="section-footnotes">
                      <sup v-for="c in footnoteCites(s, selected)" :key="c.source.id">[{{ c.footnoteNumber }}]</sup>
                    </div>
                  </div>
                </template>
                <footer v-if="cardFootnotes(selected).length" class="card-kilder">
                  <div class="kilder-label">Kilder</div>
                  <ol class="kilder-list">
                    <li v-for="c in cardFootnotes(selected)" :key="c.source.id" :value="c.footnoteNumber">
                      <component
                        :is="c.source.url ? 'a' : 'span'"
                        v-bind="c.source.url ? { href: c.source.url, target: '_blank', rel: 'noopener noreferrer' } : {}"
                        class="kilder-ref"
                      >
                        {{ c.source.title || c.source.id
                        }}<span v-if="c.source.authorFreeText" class="kilder-author"> — {{ c.source.authorFreeText }}</span>
                      </component>
                      <span v-if="c.source.url" class="kilder-arrow"> ↗</span>
                    </li>
                  </ol>
                </footer>
                <div v-if="!selected.sections.length" class="muted">tomt</div>
              </div>
            </article>
          </template>
          <div v-else class="page-preview">
            <div class="page-preview-header">
              <span class="page-preview-label">Hele siden</span>
              <div class="zoom-control">
                <span class="zoom-icon">−</span>
                <input
                  v-model.number="zoom"
                  type="range"
                  min="0.5"
                  max="1.5"
                  step="0.1"
                  class="zoom-slider"
                  aria-label="Zoom"
                />
                <span class="zoom-icon">+</span>
                <span class="zoom-value">{{ Math.round(zoom * 100) }}%</span>
              </div>
            </div>
            <div class="zoom-wrap" :style="{ height: `${scaledHeight}px` }">
              <div
                ref="zoomInner"
                class="zoom-inner"
                :style="{ transform: `scale(${zoom})`, width: `${100 / zoom}%` }"
              >
                <div class="mini-flow">
                  <template v-for="card in cards" :key="card.id">
                    <section
                      v-if="card.kind === 'text'"
                      class="mini-block mini-text"
                      :class="`layout-${card.layout}`"
                      @click="selectCard(card.id)"
                    >
                      <h4 v-if="card.title" class="mini-text-heading">{{ card.title }}</h4>
                      <!-- eslint-disable vue/no-v-html -->
                      <div
                        v-if="cardHtml(card)"
                        class="mini-text-body portable-text"
                        v-html="cardHtml(card)"
                      ></div>
                      <!-- eslint-enable vue/no-v-html -->
                    </section>
                    <article
                      v-else
                      class="mini-block mini-card"
                      :class="`layout-${card.layout}`"
                      @click="selectCard(card.id)"
                    >
                      <img
                        v-if="cardImage(card)"
                        :src="`${cardImage(card)}?w=400&auto=format`"
                        :alt="card.title ?? ''"
                        class="mini-card-img"
                      />
                      <div class="mini-card-body">
                        <h4 v-if="card.title" class="mini-card-title">{{ card.title }}</h4>
                        <!-- eslint-disable vue/no-v-html -->
                        <div
                          v-if="cardHtml(card)"
                          class="mini-card-content portable-text"
                          v-html="cardHtml(card)"
                        ></div>
                        <!-- eslint-enable vue/no-v-html -->
                      </div>
                    </article>
                  </template>
                </div>
              </div>
            </div>
            <div class="page-preview-hint">Klikk en blokk for å redigere.</div>
          </div>
        </section>

        <section v-else class="pane">
          <template v-if="selected">
            <div class="field">
              <label class="field-label" :for="`title-${selected.id}`">Tittel</label>
              <input
                :id="`title-${selected.id}`"
                v-model="selected.title"
                class="field-input"
                type="text"
                :placeholder="selected.kind === 'text' ? 'Overskrift…' : 'Korttittel…'"
              />
            </div>

            <div class="field-row">
              <div class="field">
                <label class="field-label" :for="`kind-${selected.id}`">Type</label>
                <select
                  :id="`kind-${selected.id}`"
                  v-model="selected.kind"
                  class="field-input"
                >
                  <option value="card">Kort (med bilde)</option>
                  <option value="text">Tekst</option>
                </select>
              </div>

              <div class="field">
                <label class="field-label" :for="`layout-${selected.id}`">Bredde</label>
                <select
                  :id="`layout-${selected.id}`"
                  v-model="selected.layout"
                  class="field-input"
                >
                  <option value="full">Full</option>
                  <option value="half">1/2</option>
                  <option value="third">1/3</option>
                  <option value="quarter">1/4</option>
                </select>
              </div>
            </div>

            <div v-if="selected.kind === 'card'" class="field">
              <label class="field-label">Bilde</label>
              <div class="image-field">
                <img
                  v-if="selected.imageUrl"
                  :src="selected.imageUrl"
                  class="image-thumb"
                  alt=""
                />
                <div v-else class="image-placeholder">Ingen bilde</div>
                <label class="image-upload">
                  <input
                    type="file"
                    accept="image/*"
                    class="image-input"
                    :disabled="uploading"
                    @change="onImageChange($event, selected.id)"
                  />
                  <span>{{ uploading ? 'Laster opp…' : 'Velg fil…' }}</span>
                </label>
                <div v-if="uploadError" class="upload-error">{{ uploadError }}</div>
              </div>
            </div>

            <div v-if="selected.kind === 'text'" class="field">
              <label class="field-label" :for="`heading-${selected.id}`">Overskriftsnivå</label>
              <select
                :id="`heading-${selected.id}`"
                :value="selected.headingLevel ?? 2"
                class="field-input"
                @change="selected.headingLevel = Number(($event.target as HTMLSelectElement).value)"
              >
                <option :value="1">H1 — sidetittel</option>
                <option :value="2">H2 — seksjonsoverskrift</option>
                <option :value="3">H3 — underoverskrift</option>
              </select>
            </div>

            <SectionsEditor :sections="selected.sections" label="Innhold" />

            <div v-if="headingWarnings.length" class="validation-warning">
              <div class="validation-title">Advarsel om HTML-standard:</div>
              <ul class="validation-list">
                <li v-for="(w, i) in headingWarnings" :key="i">{{ w }}</li>
              </ul>
            </div>
          </template>
          <div v-else class="pane-empty">Velg en blokk.</div>
        </section>

        <footer v-if="dirty" class="save-footer">
          <span class="save-prompt">Ser det bra ut?</span>
          <button class="btn-primary" :disabled="saving" @click="save">
            {{ saving ? 'Lagrer…' : 'Lagre' }}
          </button>
          <button class="link-revert" :disabled="saving" @click="revert">Angre</button>
        </footer>
        <div v-if="saveError" class="save-error">{{ saveError }}</div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { neo4jQuery } from '@/composables/useNeo4j.ts'
import { blocksToHtml } from '@/utils/portableText.ts'
import { authFetch } from '@/composables/useAuth.ts'
import SectionsEditor from '@/components/SectionsEditor.vue'

const TABS = [
  { slug: 'home',  label: 'Hjem' },
  { slug: 'about', label: 'Om oss' },
] as const

interface SourceRef {
  id:             string
  title:          string | null
  url:            string | null
  authorFreeText: string | null
  license?:       string | null
  attribution?:   string | null
}

interface Citation {
  inline: boolean
  source: SourceRef
}

interface Section {
  order:       number
  content:     string   // JSON-serialized Portable Text blocks
  citations:   Citation[]
  sourcedFrom: SourceRef | null
}

interface CitationRow {
  inline:       boolean | null
  sourceId:     string | null
  sourceTitle:  string | null
  sourceUrl:    string | null
  sourceAuthor: string | null
}

interface SectionRow {
  order:       number
  content:     string
  citations:   CitationRow[]
  sourcedFrom: SourceRef | null
}

interface CardRow {
  id:           string
  order:        number
  kind:         string | null
  layout:       string | null
  title:        string | null
  headingLevel: number | null
  sections:     SectionRow[]
  imageUrl:     string | null
}

interface Card {
  id:           string
  order:        number
  kind:         string | null
  layout:       string | null
  title:        string | null
  headingLevel: number | null
  sections:     Section[]
  imageUrl:     string | null
}

const PAGE_QUERY = `
MATCH (p:Page {slug: $slug})-[:HAS_CARD]->(c:Card)
OPTIONAL MATCH (c)-[:HAS_HERO_IMAGE]->(hero:Source)
OPTIONAL MATCH (c)-[:HAS_CONTENT]->(d:Description)
OPTIONAL MATCH (d)-[:SOURCED_FROM]->(from:Source)
WITH c, hero, d, from
  ORDER BY coalesce(d.order, 1)
OPTIONAL MATCH (d)-[cites:CITES]->(src:Source)
WITH c, hero, d, from,
     collect(CASE WHEN src IS NULL THEN NULL ELSE {
       inline:       coalesce(cites.inline, false),
       sourceId:     src.id,
       sourceTitle:  src.title,
       sourceUrl:    src.url,
       sourceAuthor: src.authorFreeText
     } END) AS rawCites
WITH c, hero, d, from, [x IN rawCites WHERE x IS NOT NULL] AS citations
WITH c, hero, collect(CASE WHEN d IS NULL THEN NULL ELSE {
  order:       coalesce(d.order, 1),
  content:     d.content,
  citations:   citations,
  sourcedFrom: CASE WHEN from IS NULL THEN NULL ELSE {
    id:             from.id,
    title:          from.title,
    url:            from.url,
    authorFreeText: from.authorFreeText,
    license:        from.license,
    attribution:    from.attribution
  } END
} END) AS rawSections
WITH c, hero, [x IN rawSections WHERE x IS NOT NULL] AS sections
RETURN c.id AS id, c.order AS order, c.kind AS kind, c.layout AS layout,
       c.title AS title, c.headingLevel AS headingLevel,
       hero.url AS imageUrl, sections
ORDER BY c.order
`

const route = useRoute()
const activeSlug = computed(() => String(route.params.slug ?? 'home'))

const cards = ref<Card[]>([])
const loading = ref(true)
const error = ref(false)
const selectedId = ref<string | null>(null)
const draggingId = ref<string | null>(null)
const originalById = ref<Map<string, Card>>(new Map())
const paneView = ref<'edit' | 'preview'>('preview')

const SCALAR_FIELDS = ['order', 'title', 'layout', 'kind', 'headingLevel'] as const

const selected = computed(() => cards.value.find(c => c.id === selectedId.value) ?? null)

function cardHtml(card: Card): string {
  return (card.sections ?? [])
    .map(s => {
      try { return blocksToHtml(JSON.parse(s.content) as unknown[]) }
      catch { return '' }
    })
    .join('')
}

function rowToCard(r: CardRow): Card {
  return {
    ...r,
    sections: (r.sections ?? []).map(s => ({
      order:   s.order,
      content: s.content,
      citations: (s.citations ?? [])
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
      sourcedFrom: s.sourcedFrom ? { ...s.sourcedFrom } : null,
    })),
  }
}

function cloneCard(c: Card): Card {
  return {
    ...c,
    sections: c.sections.map(s => ({
      ...s,
      citations:   s.citations.map(x => ({ ...x, source: { ...x.source } })),
      sourcedFrom: s.sourcedFrom ? { ...s.sourcedFrom } : null,
    })),
  }
}

function sectionsSignature(sections: Section[]): string {
  return JSON.stringify(
    [...sections]
      .sort((a, b) => a.order - b.order)
      .map(s => [
        s.order,
        s.content,
        s.citations.map(c => [c.inline, c.source.id]),
        s.sourcedFrom?.id ?? null,
      ]),
  )
}

function cardImage(card: Card): string | null {
  return card.imageUrl ?? null
}

function sectionHtml(s: Section): string {
  try { return blocksToHtml(JSON.parse(s.content) as unknown[]) }
  catch { return '' }
}

function inlineCites(s: Section): Citation[] {
  return s.citations.filter(c => c.inline)
}

/** Numbered footnotes for this card, in render order; footnoteNumber set. */
function cardFootnotes(card: Card): (Citation & { footnoteNumber: number })[] {
  const out: (Citation & { footnoteNumber: number })[] = []
  for (const sec of [...card.sections].sort((a, b) => a.order - b.order)) {
    for (const c of sec.citations) {
      if (!c.inline) out.push({ ...c, footnoteNumber: out.length + 1 })
    }
  }
  return out
}

/** The footnote entries belonging to the given section within this card. */
function footnoteCites(s: Section, card: Card): (Citation & { footnoteNumber: number })[] {
  const all = cardFootnotes(card)
  return all.filter(fn => s.citations.some(c => !c.inline && c.source.id === fn.source.id))
}


interface CardDiff {
  order?:        number
  title?:        string | null
  layout?:       string
  kind?:         string
  headingLevel?: number | null
  sections?:     Section[]
}

function changedFields(card: Card): CardDiff | null {
  const orig = originalById.value.get(card.id)
  if (!orig) return null
  const diff: CardDiff = {}
  let has = false
  for (const f of SCALAR_FIELDS) {
    if (card[f] !== orig[f]) {
      (diff as Record<string, unknown>)[f] = card[f]
      has = true
    }
  }
  if (sectionsSignature(card.sections) !== sectionsSignature(orig.sections)) {
    diff.sections = [...card.sections].sort((a, b) => a.order - b.order)
    has = true
  }
  return has ? diff : null
}

const dirty = computed(() => cards.value.some(c => changedFields(c) !== null))

/**
 * Build the heading outline for the current page and flag standards violations.
 * Rules:
 *   - At most one h1 per page
 *   - No skipped levels (h3 without a preceding h2)
 * Text cards with a title contribute at their headingLevel (default 2).
 * Image cards always contribute h3 (rendered as <h3 class="card-title">).
 */
const headingWarnings = computed<string[]>(() => {
  const levels: number[] = []
  for (const c of [...cards.value].sort((a, b) => a.order - b.order)) {
    if (c.kind === 'text' && c.title) {
      const raw = Number(c.headingLevel ?? 2)
      const lvl = raw >= 1 && raw <= 3 ? raw : 2
      levels.push(lvl)
    } else if (c.kind !== 'text' && c.title) {
      levels.push(2)
    }
  }

  const warnings: string[] = []
  const h1Count = levels.filter(l => l === 1).length
  if (h1Count > 1) warnings.push(`Flere H1 på siden (${h1Count}) — bare én er tillatt.`)

  const haveH2 = levels.some(l => l === 2)
  const haveH3 = levels.some(l => l === 3)
  if (haveH3 && !haveH2 && levels.filter(l => l === 1).length === 0) {
    warnings.push('H3 brukes uten en H2 før.')
  } else if (haveH3 && !haveH2 && levels.filter(l => l === 1).length > 0) {
    warnings.push('H3 brukes uten en H2 imellom H1 og H3.')
  }

  return warnings
})

function selectCard(id: string) {
  selectedId.value = selectedId.value === id ? null : id
  paneView.value = 'preview'
}

function onDragStart(id: string, e: DragEvent) {
  draggingId.value = id
  e.dataTransfer?.setData('text/plain', id)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onDragEnd() {
  draggingId.value = null
}

function onDragOver(targetId: string) {
  if (!draggingId.value || draggingId.value === targetId) return
  const from = cards.value.findIndex(c => c.id === draggingId.value)
  const to   = cards.value.findIndex(c => c.id === targetId)
  if (from === -1 || to === -1) return
  const [moved] = cards.value.splice(from, 1)
  cards.value.splice(to, 0, moved)
  cards.value.forEach((c, i) => { c.order = i + 1 })
}

function onDrop() {
  draggingId.value = null
}

async function load(slug: string) {
  loading.value = true
  error.value = false
  selectedId.value = null
  try {
    const rows = await neo4jQuery<CardRow>(PAGE_QUERY, { slug })
    cards.value = rows.map(rowToCard)
    originalById.value = new Map(cards.value.map(c => [c.id, cloneCard(c)]))
  } catch {
    error.value = true
  } finally {
    loading.value = false
  }
}

watch(activeSlug, slug => void load(slug), { immediate: true })

const saving    = ref(false)
const saveError = ref<string | null>(null)
const uploading   = ref(false)
const uploadError = ref<string | null>(null)

async function onImageChange(e: Event, cardId: string) {
  const input = e.target as HTMLInputElement
  const file  = input.files?.[0]
  if (!file) return

  uploading.value = true
  uploadError.value = null
  try {
    const form = new FormData()
    form.append('file', file)
    const res = await authFetch(
      `/api/admin/pages/${activeSlug.value}/cards/${encodeURIComponent(cardId)}/image`,
      { method: 'POST', body: form },
    )
    const body = await res.json().catch(() => ({})) as { url?: string; error?: string }
    if (!res.ok || !body.url) {
      uploadError.value = body.error ?? `HTTP ${res.status}`
      return
    }
    const card = cards.value.find(c => c.id === cardId)
    if (card) {
      card.imageUrl = body.url
      const orig = originalById.value.get(cardId)
      if (orig) orig.imageUrl = body.url
    }
    input.value = ''
  } catch (err) {
    uploadError.value = (err as Error).message
  } finally {
    uploading.value = false
  }
}

function revert() {
  void load(activeSlug.value)
}

async function save() {
  saving.value = true
  saveError.value = null
  try {
    const items = cards.value
      .map(c => {
        const diff = changedFields(c)
        if (!diff) return null
        const payload: Record<string, unknown> = { id: c.id, ...diff }
        if (diff.sections) {
          payload.sections = diff.sections.map(s => ({
            order:          s.order,
            content:        s.content,
            citations:      s.citations.map(x => ({ inline: x.inline, sourceId: x.source.id })),
            sourcedFromId:  s.sourcedFrom?.id ?? null,
          }))
        }
        return payload
      })
      .filter((x): x is Record<string, unknown> & { id: string } => x !== null)

    if (!items.length) { saving.value = false; return }

    const res = await authFetch(`/api/admin/pages/${activeSlug.value}/cards`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ items }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      saveError.value = body.error ?? `HTTP ${res.status}`
      return
    }
    originalById.value = new Map(cards.value.map(c => [c.id, {
      ...c,
      sections: c.sections.map(s => ({ ...s })),
    }]))
  } catch (e) {
    saveError.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

const zoom = ref(0.7)
const zoomInner = ref<HTMLElement | null>(null)
const innerHeight = ref(0)
const scaledHeight = computed(() => innerHeight.value * zoom.value)

let ro: ResizeObserver | null = null
onMounted(() => {
  ro = new ResizeObserver(entries => {
    for (const e of entries) innerHeight.value = e.contentRect.height
  })
  watch(zoomInner, el => {
    ro?.disconnect()
    if (el) ro?.observe(el)
  }, { immediate: true })
})
onUnmounted(() => ro?.disconnect())
</script>

<style scoped>
.admin-pages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: var(--paper);
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
}

.tab-strip {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--rule);
  margin-bottom: 24px;
}

.tab {
  padding: 10px 16px;
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
  text-decoration: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}

.tab.active {
  color: var(--focus);
  border-bottom-color: var(--focus);
}

.editor {
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: 16px;
  align-items: start;
}

@media (max-width: 720px) {
  .editor { grid-template-columns: 1fr; }
}

/* ── Tree ───────────────────────────────────────────────────── */
.tree {
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: 8px;
  padding: 12px;
}

.tree-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  padding: 4px 8px;
  margin-bottom: 4px;
}

.tree-cards {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 4px;
}

.tree-empty {
  padding: 8px 10px;
  font-size: 12px;
  color: var(--muted);
  font-style: italic;
  text-align: center;
}

.card-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: 6px;
  font-size: 13px;
  cursor: grab;
  user-select: none;
}

.card-chip:hover { border-color: var(--focus); }
.card-chip:active { cursor: grabbing; }

.card-chip.active {
  background: var(--focus);
  color: #fff;
  border-color: var(--focus);
}

.card-chip.active .card-chip-meta { color: rgba(255, 255, 255, 0.7); }

.card-chip.dragging { opacity: 0.4; }

.drag-handle {
  color: var(--muted);
  font-size: 12px;
  letter-spacing: -2px;
  flex-shrink: 0;
}
.card-chip.active .drag-handle { color: rgba(255, 255, 255, 0.6); }

.card-chip-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.card-chip-meta {
  font-size: 10px;
  color: var(--muted);
  font-family: monospace;
  flex-shrink: 0;
}

/* ── Panes ──────────────────────────────────────────────────── */
.panes { display: flex; flex-direction: column; }

.pane-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--rule);
  margin-bottom: 16px;
}

.pane-tab {
  padding: 10px 16px;
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  cursor: pointer;
}

.pane-tab.active {
  color: var(--focus);
  border-bottom-color: var(--focus);
}

.pane {
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: 8px;
  padding: 20px;
  min-height: 200px;
}

.pane-empty {
  color: var(--muted);
  font-size: 13px;
  text-align: center;
  padding: 48px 0;
  font-style: italic;
}

/* ── Field inputs ───────────────────────────────────────────── */
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 16px;
}

.field-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
}

.field-input {
  width: 100%;
  padding: 9px 12px;
  font-size: 14px;
  color: var(--ink);
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: 6px;
  box-sizing: border-box;
  font-family: inherit;
}
.field-input:focus {
  outline: 2px solid var(--focus);
  outline-offset: -1px;
  border-color: var(--focus);
}

select.field-input {
  appearance: none;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path fill='%23666' d='M0 0l5 6 5-6z'/></svg>");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding-right: 32px;
}

.field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.validation-warning {
  margin-bottom: 16px;
  padding: 10px 12px;
  background: #fffbeb;
  border: 1px solid #fcd34d;
  border-radius: 6px;
  font-size: 12px;
  color: #92400e;
}

.validation-title {
  font-weight: 700;
  margin-bottom: 4px;
}

.validation-list {
  margin: 0;
  padding-left: 18px;
}

/* ── Sections list ──────────────────────────────────────────── */
.field-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}

.btn-secondary-outline {
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  background: transparent;
  color: var(--focus);
  border: 1px solid var(--rule);
  border-radius: 4px;
  cursor: pointer;
}
.btn-secondary-outline:hover { border-color: var(--focus); }

.sections {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.sections-empty {
  padding: 16px;
  text-align: center;
  font-size: 13px;
  color: var(--muted);
  font-style: italic;
  border: 1px dashed var(--rule);
  border-radius: 6px;
}

.section-block {
  padding: 12px;
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: 6px;
}

.section-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
}

.section-index {
  flex: 1;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
}

.section-btn {
  width: 24px;
  height: 24px;
  padding: 0;
  font-size: 12px;
  background: transparent;
  border: 1px solid var(--rule);
  border-radius: 3px;
  cursor: pointer;
  color: var(--ink);
}
.section-btn:hover { border-color: var(--focus); }

.section-btn-delete { color: #b91c1c; }
.section-btn-delete:hover { background: #fef2f2; border-color: #fecaca; }

.section-cites {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--rule);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.section-cites-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section-cites-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
}

.section-cites-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.section-cite-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: 4px;
  font-size: 12px;
}

.section-cite-inline {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--muted);
  cursor: pointer;
  user-select: none;
  flex-shrink: 0;
}

.section-cite-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.section-cite-author {
  font-size: 11px;
  color: var(--muted);
  flex-shrink: 0;
}

.section-cite-edit {
  list-style: none;
  padding: 0;
}

.section-sourced {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--rule);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.section-sourced-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
}

.section-sourced-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: 4px;
  font-size: 12px;
}

.sc-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sc-license {
  font-family: monospace;
  font-size: 10px;
  padding: 1px 6px;
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: 8px;
  color: var(--muted);
}

/* Match public `sourced-from` strip inside the admin preview */
.card-preview .sourced-from {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  margin: -6px 0 12px 18px;
  font-size: 11px;
  color: var(--muted);
}
.card-preview .sourced-label {
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-size: 10px;
}
.card-preview .sourced-link { color: var(--focus); text-decoration: underline; }
.card-preview .sourced-license {
  font-family: monospace;
  font-size: 10px;
  padding: 1px 6px;
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: 8px;
  color: var(--muted);
}

.section-author {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}

.section-author-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
  flex-shrink: 0;
}

.section-author .person-picker {
  flex: 1;
}

/* ── Image upload ───────────────────────────────────────────── */
.image-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.image-thumb {
  max-width: 240px;
  border-radius: 6px;
  border: 1px solid var(--rule);
  display: block;
}

.image-placeholder {
  width: 240px;
  height: 135px;
  background: var(--paper);
  border: 1px dashed var(--rule);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--muted);
  font-style: italic;
}

.image-upload {
  display: inline-flex;
  align-items: center;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--focus);
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: 4px;
  cursor: pointer;
  align-self: flex-start;
}
.image-upload:hover { border-color: var(--focus); }

.image-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.upload-error {
  font-size: 12px;
  color: #b91c1c;
}

.preview-meta {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 16px;
  font-size: 11px;
  color: var(--muted);
  font-family: monospace;
}

.meta-sep { opacity: 0.5; }

.id-chip code {
  font-family: monospace;
  font-size: 11px;
  background: var(--paper);
  padding: 2px 6px;
  border-radius: 3px;
  color: var(--muted);
}

.card-preview {
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: 8px;
  overflow: hidden;
}

.preview-img { width: 100%; height: auto; display: block; }

.preview-body { padding: 16px; }

.preview-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--focus);
  margin: 0 0 12px;
  line-height: 1.3;
}

.preview-content :deep(p) {
  margin: 0 0 0.75em;
  line-height: 1.7;
  font-size: 13px;
  color: var(--muted);
}
.preview-content :deep(p:last-child) { margin-bottom: 0; }
.preview-content :deep(strong) { font-weight: 500; color: var(--ink); }
.preview-content :deep(em) { font-style: italic; }
.preview-content :deep(a) { color: var(--focus); text-decoration: underline; }

.card-preview .section-wrap { position: relative; }

.card-preview .is-quote {
  border-left: 3px solid var(--rule, var(--rule));
  padding: 2px 14px;
  margin: 12px 0 12px 2px;
  font-style: italic;
  color: var(--ink);
}

.card-preview .inline-cites {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 6px 0 10px;
}

.card-preview .cite-chip {
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
.card-preview .cite-chip:hover { border-color: var(--focus); }
.card-preview .cite-chip-author { color: var(--muted); }
.card-preview .cite-chip-arrow  { font-size: 10px; opacity: 0.6; }

.card-preview .section-footnotes {
  position: absolute;
  right: 0;
  bottom: 0;
  display: flex;
  gap: 2px;
  font-size: 11px;
  color: var(--muted);
}

.card-preview .card-kilder {
  border-top: 1px solid var(--rule);
  margin-top: 12px;
  padding-top: 10px;
}
.card-preview .kilder-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 6px;
}
.card-preview .kilder-list {
  margin: 0;
  padding-left: 22px;
  font-size: 11px;
  color: var(--muted);
  line-height: 1.5;
}
.card-preview .kilder-list li { margin-bottom: 3px; }
.card-preview .kilder-ref {
  color: inherit;
  text-decoration: none;
}
.card-preview .kilder-list a.kilder-ref {
  color: var(--focus);
  text-decoration: underline;
}
.card-preview .kilder-list a.kilder-ref .kilder-author { color: var(--muted); }
.card-preview .kilder-arrow { font-size: 10px; opacity: 0.6; color: var(--focus); }

.muted { color: var(--muted); font-style: italic; font-size: 13px; }

/* ── Save footer ────────────────────────────────────────────── */
.save-footer {
  margin-top: 16px;
  padding: 12px 14px;
  background: #fef3c7;
  border: 1px solid #fcd34d;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.save-prompt { flex: 1; font-size: 13px; color: #92400e; font-weight: 600; }
.tree-save { margin-top: 12px; flex-wrap: wrap; }
.tree-save .save-prompt { flex-basis: 100%; font-size: 12px; margin-bottom: 4px; }
.btn-primary {
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 600;
  background: var(--focus);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.link-revert {
  background: transparent;
  border: none;
  padding: 0;
  font-size: 12px;
  color: #92400e;
  text-decoration: underline;
  cursor: pointer;
}
.link-revert:disabled { opacity: 0.5; cursor: not-allowed; }
.save-error {
  margin-top: 8px;
  padding: 8px 10px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  font-size: 12px;
  color: #b91c1c;
}

/* ── Whole-page preview ─────────────────────────────────────── */
.page-preview { display: flex; flex-direction: column; gap: 12px; }

.page-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.page-preview-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}

.zoom-control { display: flex; align-items: center; gap: 6px; }
.zoom-icon {
  font-size: 12px; color: var(--muted); font-weight: 700;
  width: 10px; text-align: center;
}
.zoom-slider { width: 100px; accent-color: var(--focus); }
.zoom-value {
  font-size: 11px; color: var(--muted); font-family: monospace;
  width: 36px; text-align: right;
}

.zoom-wrap { overflow: hidden; transition: height 0.1s; }

.zoom-inner { transform-origin: top left; }

.mini-flow {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.mini-block {
  flex-grow: 1;
  flex-shrink: 0;
  min-width: 0;
  cursor: pointer;
  transition: border-color 0.1s;
}

.mini-block.layout-full    { flex-basis: 100%; }
.mini-block.layout-half    { flex-basis: calc(50% - 6px); }
.mini-block.layout-third   { flex-basis: calc(33.333% - 8px); }
.mini-block.layout-quarter { flex-basis: calc(25% - 9px); }

.mini-text {
  padding: 8px 10px;
  text-align: center;
  border: 1px dashed transparent;
  border-radius: 6px;
}
.mini-text:hover { border-color: var(--focus); }

.mini-text-heading {
  font-size: 16px;
  font-weight: 700;
  color: var(--focus);
  margin: 0 0 4px;
}

.mini-text-body :deep(p) {
  margin: 0 0 0.4em;
  font-size: 11px;
  line-height: 1.5;
  color: var(--muted);
}

.mini-card {
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: 6px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.mini-card:hover { border-color: var(--focus); }

.mini-card-img { width: 100%; height: auto; display: block; }

.mini-card-body { padding: 8px 10px; }

.mini-card-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--focus);
  margin: 0 0 4px;
  line-height: 1.3;
}

.mini-card-content :deep(p) {
  margin: 0 0 0.4em;
  line-height: 1.5;
  font-size: 10px;
  color: var(--muted);
}
.mini-card-content :deep(p:last-child) { margin-bottom: 0; }

.page-preview-hint {
  font-size: 12px;
  color: var(--muted);
  font-style: italic;
  text-align: center;
  margin-top: 4px;
}

.status { padding: 24px; font-size: 13px; color: var(--muted); text-align: center; }
.error  { color: var(--faded-red); }
</style>
