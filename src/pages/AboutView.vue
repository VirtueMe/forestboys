<template>
  <div class="about-page">
    <div v-if="loading" class="status">Laster…</div>
    <div v-else-if="error" class="status error">Kunne ikke laste innhold.</div>

    <main v-else class="page-flow">
      <header class="page-header layout-full">
        <h1 class="page-title">Om oss</h1>
      </header>

      <template v-for="card in cards" :key="card.id">
        <section
          v-if="card.kind === 'text'"
          class="block block-text"
          :class="`layout-${card.layout}`"
        >
          <component
            v-if="card.title"
            :is="`h${card.headingLevel}`"
            class="block-heading"
          >
            {{ card.title }}
          </component>
          <template v-for="s in card.sections" :key="s.order">
            <div class="section-wrap">
              <!-- eslint-disable vue/no-v-html -->
              <div
                class="block-body portable-text"
                :class="{ 'is-quote': s.citations.length > 0 }"
                @click.capture="handleInternalLinks"
                v-html="s.html"
              ></div>
              <!-- eslint-enable vue/no-v-html -->
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

        <article
          v-else
          class="block block-card"
          :class="`layout-${card.layout}`"
        >
          <img
            v-if="card.imageUrl"
            :src="`${card.imageUrl}?w=400&auto=format`"
            :alt="card.title ?? ''"
            class="card-img"
            loading="lazy"
          />
          <div class="card-body">
            <h2 v-if="card.title" class="card-title">{{ card.title }}</h2>
            <template v-for="s in card.sections" :key="s.order">
              <div class="section-wrap">
                <!-- eslint-disable vue/no-v-html -->
                <div
                  class="card-desc portable-text"
                  :class="{ 'is-quote': s.citations.length > 0 }"
                  @click.capture="handleInternalLinks"
                  v-html="s.html"
                ></div>
                <!-- eslint-enable vue/no-v-html -->
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

    <EditPageButton slug="about" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { neo4jQuery } from '@/composables/useNeo4j.ts'
import { blocksToHtml } from '@/utils/portableText.ts'
import EditPageButton from '@/components/EditPageButton.vue'

interface CitationRow {
  inline:       boolean | null
  sourceId:     string | null
  sourceTitle:  string | null
  sourceUrl:    string | null
  sourceAuthor: string | null
}

interface SectionRow {
  order:     number | null
  content:   string | null
  citations: CitationRow[]
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
  footnoteNumber?: number
}

interface Section {
  order:     number
  html:      string
  citations: Citation[]
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
  footnotes:    Citation[]
}

const PAGE_QUERY = `
MATCH (p:Page {slug: "about"})-[:HAS_CARD]->(c:Card)
OPTIONAL MATCH (c)-[:HAS_HERO_IMAGE]->(hero:Source)
OPTIONAL MATCH (c)-[:HAS_CONTENT]->(d:Description)
WITH c, hero, d
  ORDER BY coalesce(d.order, 1)
OPTIONAL MATCH (d)-[cites:CITES]->(src:Source)
WITH c, hero, d,
     collect(CASE WHEN src IS NULL THEN NULL ELSE {
       inline:       coalesce(cites.inline, false),
       sourceId:     src.id,
       sourceTitle:  src.title,
       sourceUrl:    src.url,
       sourceAuthor: src.authorFreeText
     } END) AS rawCites
WITH c, hero, d, [x IN rawCites WHERE x IS NOT NULL] AS citations
WITH c, hero, collect(CASE WHEN d IS NULL THEN NULL ELSE {
  order:     coalesce(d.order, 1),
  content:   d.content,
  citations: citations
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
      return { order: s.order ?? 1, html, citations }
    })
    .sort((a, b) => a.order - b.order)

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

function inlineCites(s: Section):   Citation[] { return s.citations.filter(c => c.inline) }
function footnoteCites(s: Section): Citation[] { return s.citations.filter(c => !c.inline) }


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
    cards.value = rows.map(rowToBlock)
  } catch {
    error.value = true
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.about-page {
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

.page-header { padding: 16px 0; }

.page-title {
  font-size: 28px;
  font-weight: 700;
  color: var(--color-navy);
  margin: 0;
}

.block-text { padding: 16px 0; }

.block-heading {
  font-size: 22px;
  font-weight: 700;
  color: var(--color-navy);
  margin: 0 0 12px;
  line-height: 1.3;
}

.block-body {
  font-size: 14px;
  line-height: 1.7;
  color: var(--color-text);
}

.block-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.card-img {
  width: 100%;
  height: auto;
  display: block;
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

.card-desc :deep(p) {
  margin: 0 0 0.75em;
  line-height: 1.7;
  font-size: 13px;
  color: var(--color-muted);
}

.card-desc :deep(p:last-child) { margin-bottom: 0; }
.card-desc :deep(a) {
  color: var(--color-navy);
  text-decoration: underline;
}

.section-wrap { position: relative; }

.is-quote {
  border-left: 3px solid var(--color-border-mid, var(--color-border));
  padding: 2px 14px;
  margin: 12px 0 12px 2px;
  font-style: italic;
  color: var(--color-text);
}

.inline-cites { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 10px; }

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
</style>
