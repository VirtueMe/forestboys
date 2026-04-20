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
            <!-- eslint-disable vue/no-v-html -->
            <div
              class="block-body portable-text"
              @click.capture="handleInternalLinks"
              v-html="s.html"
            ></div>
            <!-- eslint-enable vue/no-v-html -->
          </template>
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
              <!-- eslint-disable vue/no-v-html -->
              <div
                class="card-desc portable-text"
                @click.capture="handleInternalLinks"
                v-html="s.html"
              ></div>
              <!-- eslint-enable vue/no-v-html -->
              <cite v-if="s.authorSlug" class="byline">
                — <router-link :to="`/person/${s.authorSlug}`">{{ s.authorName || s.authorSlug }}</router-link>
              </cite>
            </template>
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

interface SectionRow {
  order:   number | null
  content: string | null
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

interface Section {
  order: number
  html:  string
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
}

const PAGE_QUERY = `
MATCH (p:Page {slug: "home"})-[:HAS_CARD]->(c:Card)
OPTIONAL MATCH (c)-[:HAS_HERO_IMAGE]->(s:Source)
OPTIONAL MATCH (c)-[:HAS_CONTENT]->(d:Description)
WITH c, s, d ORDER BY coalesce(d.order, 1)
WITH c, s, [x IN collect(d) WHERE x IS NOT NULL | {order: coalesce(x.order, 1), content: x.content}] AS sections
RETURN c.id AS id, c.order AS order, c.kind AS kind, c.layout AS layout,
       c.title AS title, c.headingLevel AS headingLevel,
       s.url AS imageUrl, sections
ORDER BY c.order
`

const router = useRouter()
const cards = ref<Block[]>([])
const loading = ref(true)
const error = ref(false)

function cardSrc(url: string): string {
  return `${url}?w=700&auto=format`
}

function rowToBlock(r: CardRow): Block {
  const sections: Section[] = (r.sections ?? [])
    .filter(s => s.content)
    .map(s => {
      let html = ''
      try { html = blocksToHtml(JSON.parse(s.content!) as unknown[]) } catch { /* skip */ }
      return { order: s.order ?? 1, html }
    })
    .sort((a, b) => a.order - b.order)
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
