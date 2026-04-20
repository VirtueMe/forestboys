<template>
  <div class="home">
    <div v-if="loading" class="status">Laster…</div>

    <div v-else-if="error" class="status error">Kunne ikke laste innhold.</div>

    <main v-else class="page-flow">
      <template v-for="card in cards" :key="card.id">
        <!-- Text card (intro / title bar) -->
        <section
          v-if="card.kind === 'text'"
          class="block block-text"
          :class="`layout-${card.layout}`"
        >
          <component
            v-if="card.title"
            :is="`h${card.headingLevel}`"
            class="block-heading"
            :class="`heading-level-${card.headingLevel}`"
          >
            {{ card.title }}
          </component>
          <template v-for="s in card.sections" :key="s.order">
            <div class="section-wrap">
              <!-- eslint-disable vue/no-v-html -->
              <div
                class="block-body portable-text"
                :class="{ 'is-quote': s.citations.length > 0 || s.sourcedFrom }"
                @click.capture="handleInternalLinks"
                v-html="s.html"
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
              <div v-if="footnoteCites(s).length" class="section-footnotes">
                <sup v-for="c in footnoteCites(s)" :key="c.source.id">[{{ c.footnoteNumber }}]</sup>
              </div>
            </div>
          </template>
          <footer v-if="card.footnotes.length" class="card-kilder">
            <div class="kilder-label">Kilder</div>
            <ol class="kilder-list">
              <li v-for="c in card.footnotes" :key="c.source.id" :value="c.footnoteNumber">
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
        </section>

        <!-- Image card -->
        <article
          v-else
          class="block block-card"
          :class="`layout-${card.layout}`"
        >
          <div class="card-img-wrap">
            <img
              v-if="card.imageUrl"
              :src="cardSrc(card.imageUrl)"
              :alt="card.title ?? ''"
              class="card-img"
              loading="lazy"
            />
            <div v-else class="card-img-placeholder"></div>
          </div>
          <div class="card-body">
            <h2 v-if="card.title" class="card-title">{{ card.title }}</h2>
            <template v-for="s in card.sections" :key="s.order">
              <div class="section-wrap">
                <!-- eslint-disable vue/no-v-html -->
                <div
                  class="card-desc portable-text"
                  :class="{ 'is-quote': s.citations.length > 0 || s.sourcedFrom }"
                  @click.capture="handleInternalLinks"
                  v-html="s.html"
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
                <div v-if="footnoteCites(s).length" class="section-footnotes">
                  <sup v-for="c in footnoteCites(s)" :key="c.source.id">[{{ c.footnoteNumber }}]</sup>
                </div>
              </div>
            </template>
            <footer v-if="card.footnotes.length" class="card-kilder">
              <div class="kilder-label">Kilder</div>
              <ol class="kilder-list">
                <li v-for="c in card.footnotes" :key="c.source.id" :value="c.footnoteNumber">
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
        </article>
      </template>
    </main>

    <EditPageButton slug="home" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { neo4jQuery } from '@/composables/useNeo4j.ts'
import { blocksToHtml } from '@/utils/portableText.ts'
import EditPageButton from '@/components/EditPageButton.vue'

interface CitationRow {
  inline:         boolean | null
  sourceId:       string | null
  sourceTitle:    string | null
  sourceUrl:      string | null
  sourceAuthor:   string | null
}

interface SourceRef {
  id:             string
  title:          string | null
  url:            string | null
  authorFreeText: string | null
  license:        string | null
  attribution:    string | null
}

interface SectionRow {
  order:       number | null
  content:     string | null
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

interface Citation {
  inline: boolean
  source: {
    id:             string
    title:          string | null
    url:            string | null
    authorFreeText: string | null
  }
  /** Populated for non-inline citations during render — the card-scoped footnote index. */
  footnoteNumber?: number
}

interface Section {
  order:       number
  html:        string
  citations:   Citation[]
  sourcedFrom: SourceRef | null
}

interface Block {
  id:           string
  order:        number
  kind:         'card' | 'text'
  layout:       'full' | 'half' | 'third' | 'quarter'
  title:        string | null
  headingLevel: 1 | 2 | 3
  sections:     Section[]
  imageUrl:     string | null
  /** Flat list of non-inline citations from this card's sections, in render order. */
  footnotes:    Citation[]
}

const PAGE_QUERY = `
MATCH (p:Page {slug: "home"})-[:HAS_CARD]->(c:Card)
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

const router = useRouter()
const cards = ref<Block[]>([])
const loading = ref(true)
const error = ref(false)

function cardSrc(url: string): string {
  return `${url}?w=700&auto=format`
}

function inlineCites(s: Section):   Citation[] { return s.citations.filter(c => c.inline) }
function footnoteCites(s: Section): Citation[] { return s.citations.filter(c => !c.inline) }


function rowToBlock(r: CardRow): Block {
  const sections: Section[] = (r.sections ?? [])
    .filter(s => s.content)
    .map(s => {
      let html = ''
      try { html = blocksToHtml(JSON.parse(s.content!) as unknown[]) } catch { /* skip */ }
      const citations: Citation[] = (s.citations ?? [])
        .filter(c => c.sourceId)
        .map(c => ({
          inline: c.inline ?? false,
          source: {
            id:             c.sourceId!,
            title:          c.sourceTitle,
            url:            c.sourceUrl,
            authorFreeText: c.sourceAuthor,
          },
        }))
      return {
        order:       s.order ?? 1,
        html,
        citations,
        sourcedFrom: s.sourcedFrom,
      }
    })
    .sort((a, b) => a.order - b.order)

  // Assign card-scoped footnote numbers to non-inline citations in render order.
  const footnotes: Citation[] = []
  for (const sec of sections) {
    for (const c of sec.citations) {
      if (!c.inline) {
        c.footnoteNumber = footnotes.length + 1
        footnotes.push(c)
      }
    }
  }

  const rawLevel = Number(r.headingLevel ?? 2)
  const headingLevel = (rawLevel >= 1 && rawLevel <= 3 ? rawLevel : 2) as 1 | 2 | 3
  return {
    id:           r.id,
    order:        r.order ?? 0,
    kind:         (r.kind as 'card' | 'text') ?? 'card',
    layout:       (r.layout as Block['layout']) ?? 'full',
    title:        r.title,
    headingLevel,
    sections,
    imageUrl:     r.imageUrl,
    footnotes,
  }
}

function handleInternalLinks(e: MouseEvent) {
  const link = (e.target as HTMLElement).closest('a.internal-link')
  if (link) {
    e.preventDefault()
    router.push(link.getAttribute('href') ?? '/')
  }
}

onMounted(async () => {
  try {
    const rows = await neo4jQuery<CardRow>(PAGE_QUERY)
    if (!rows.length) { error.value = true; return }
    cards.value = rows.map(rowToBlock)
  } catch {
    error.value = true
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.home {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: var(--color-bg);
}

.status {
  padding: 48px 24px;
  text-align: center;
  font-size: 13px;
  color: var(--color-muted);
}
.error { color: var(--color-red); }

/* ── Page flow: flex-wrap with blocks sizing per layout ──────── */
.page-flow {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  padding: 24px 16px;
  max-width: 1200px;
  margin: 0 auto;
  box-sizing: border-box;
}

.block {
  flex-grow: 1;
  flex-shrink: 0;
  min-width: 0;
}

.layout-full    { flex-basis: 100%; }
.layout-half    { flex-basis: calc(50% - 8px); }
.layout-third   { flex-basis: calc(33.333% - 11px); }
.layout-quarter { flex-basis: calc(25% - 12px); }

/* ≥ 1024: 4-across / 3-across native.
 * 768–1023: quarter → third (4 cards = 3+1).
 * 560–767:  quarter/third → half (2-across).
 * < 560:    everything full width.
 */
@media (max-width: 1023px) {
  .layout-quarter { flex-basis: calc(33.333% - 11px); }
}

@media (max-width: 767px) {
  .layout-quarter,
  .layout-third { flex-basis: calc(50% - 8px); }
}

@media (max-width: 559px) {
  .layout-half,
  .layout-third,
  .layout-quarter { flex-basis: 100%; }
}

/* ── Text blocks ────────────────────────────────────────────── */
.block-text {
  padding: 16px 0;
  text-align: center;
}

.block-heading {
  font-weight: 700;
  color: var(--color-navy);
  margin: 0 0 8px;
  line-height: 1.2;
}

.heading-level-1 { font-size: 36px; }
.heading-level-2 { font-size: 24px; }
.heading-level-3 { font-size: 18px; }

.block-body {
  font-size: 15px;
  line-height: 1.75;
  color: var(--color-text);
  max-width: 720px;
  margin: 0 auto;
  text-align: left;
}

/* ── Card blocks ────────────────────────────────────────────── */
.block-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.card-img-wrap {
  overflow: hidden;
  background: var(--color-bg);
  flex-shrink: 0;
}

.card-img {
  width: 100%;
  height: auto;
  display: block;
}

.card-img-placeholder {
  width: 100%;
  aspect-ratio: 16 / 9;
  background: var(--color-navy);
  opacity: 0.12;
}

.card-body {
  padding: 16px;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.card-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--color-navy);
  margin: 0;
  line-height: 1.3;
}

.card-desc { margin: 0; }

.card-desc :deep(p) {
  margin: 0 0 0.75em;
  line-height: 1.7;
  font-size: 13px;
  color: var(--color-muted);
}

.card-desc :deep(p:last-child) { margin-bottom: 0; }
.card-desc :deep(strong) { font-weight: 500; color: var(--color-text); }
.card-desc :deep(u) { text-decoration: underline; }
.card-desc :deep(em) { font-style: italic; }

.card-desc :deep(a.internal-link),
.card-desc :deep(a.external-link) {
  color: var(--color-navy);
  text-decoration: underline;
  cursor: pointer;
}

.card-desc :deep(a.external-link::after) {
  content: ' ↗';
  font-size: 11px;
  opacity: 0.6;
}

.card-desc :deep(blockquote) {
  border-left: 3px solid var(--color-border-mid);
  padding-left: 12px;
  color: var(--color-muted);
  font-style: italic;
  margin: 0.5em 0;
}

.card-desc :deep(code) {
  font-family: monospace;
  font-size: 12px;
  background: var(--color-bg);
  padding: 1px 4px;
  border-radius: 3px;
}

/* ── Citations ──────────────────────────────────────────────── */
.section-wrap { position: relative; }

.is-quote {
  border-left: 3px solid var(--color-border-mid, var(--color-border));
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

.sourced-label {
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-size: 10px;
}

.sourced-link {
  color: var(--color-navy);
  text-decoration: underline;
}

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
  max-width: 100%;
}
.cite-chip:hover { border-color: var(--color-navy); }

.cite-chip-author { color: var(--color-muted); }
.cite-chip-arrow  { font-size: 10px; opacity: 0.6; }

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

.kilder-list li { margin-bottom: 3px; }
.kilder-author  { }

.kilder-ref {
  color: inherit;
  text-decoration: none;
}
.kilder-list a.kilder-ref {
  color: var(--color-navy);
  text-decoration: underline;
}
.kilder-list a.kilder-ref .kilder-author { color: var(--color-muted); }
.kilder-arrow { font-size: 10px; opacity: 0.6; color: var(--color-navy); }

/* ── Byline (section author attribution) ────────────────────── */
.byline {
  display: block;
  font-size: 12px;
  color: var(--color-muted);
  font-style: normal;
  margin: 4px 0 12px;
}
.byline a {
  color: var(--color-navy);
  text-decoration: underline;
}
</style>
