<template>
  <div class="home">
    <div v-if="loading" class="status">Laster…</div>

    <div v-else-if="error" class="status error">Kunne ikke laste innhold.</div>

    <template v-else-if="home">
      <!-- Intro -->
      <div v-if="home.description" class="intro">
        <p class="intro-text">{{ home.description }}</p>
      </div>

      <!-- Top cards -->
      <section v-if="home.topCards?.length" class="card-section">
        <div class="card-grid">
          <div
            v-for="card in home.topCards"
            :key="card.title"
            class="card"
          >
            <div class="card-img-wrap">
              <img
                v-if="card.imageUrl"
                :src="cardSrc(card.imageUrl)"
                :alt="card.title"
                class="card-img"
                loading="lazy"
              />
              <div v-else class="card-img-placeholder"></div>
            </div>
            <div class="card-body">
              <h2 class="card-title">{{ card.title }}</h2>
              <div
                v-if="card.descriptionHtml"
                class="card-desc portable-text"
                @click.capture="handleInternalLinks"
                v-html="card.descriptionHtml"
              ></div>
            </div>
          </div>
        </div>
      </section>

      <!-- Bottom cards -->
      <section v-if="home.bottomCards?.length" class="card-section">
        <div class="card-grid">
          <div
            v-for="card in home.bottomCards"
            :key="card.title"
            class="card"
          >
            <div class="card-img-wrap">
              <img
                v-if="card.imageUrl"
                :src="cardSrc(card.imageUrl)"
                :alt="card.title"
                class="card-img"
                loading="lazy"
              />
              <div v-else class="card-img-placeholder"></div>
            </div>
            <div class="card-body">
              <h2 class="card-title">{{ card.title }}</h2>
              <div
                v-if="card.descriptionHtml"
                class="card-desc portable-text"
                @click.capture="handleInternalLinks"
                v-html="card.descriptionHtml"
              ></div>
            </div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { neo4jQuery } from '../composables/useNeo4j.ts'
import { blocksToHtml, blocksToText } from '../utils/portableText.ts'

interface HomeCard {
  title: string
  descriptionHtml?: string
  imageUrl?: string
}

interface HomeData {
  description?: string
  topCards?: HomeCard[]
  bottomCards?: HomeCard[]
}

interface CardRow {
  section: string
  sectionOrder: number
  title: string | null
  type: string | null
  content: string | null
  imageUrl: string | null
}

const PAGE_QUERY = `
MATCH (p:Page {slug: "home"})-[:HAS_CARD]->(c:Card)
OPTIONAL MATCH (c)-[:HAS_CONTENT]->(d:Description)
OPTIONAL MATCH (c)-[:HAS_HERO_IMAGE]->(s:Source)
RETURN c.section AS section, c.sectionOrder AS sectionOrder,
       c.title AS title, c.type AS type,
       d.content AS content, s.url AS imageUrl
ORDER BY c.section, c.sectionOrder
`

const router = useRouter()
const home = ref<HomeData | null>(null)
const loading = ref(true)
const error = ref(false)

function cardSrc(url: string): string {
  return `${url}?w=700&auto=format`
}

function parseBlocks(content: string | null): unknown[] | undefined {
  if (!content) return undefined
  try { return JSON.parse(content) as unknown[] } catch { return undefined }
}

function rowToCard(r: CardRow): HomeCard {
  const blocks = parseBlocks(r.content)
  const html = blocksToHtml(blocks)
  return {
    title: r.title ?? '',
    descriptionHtml: html || undefined,
    imageUrl: r.imageUrl ?? undefined,
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

    const middle = rows.find(r => r.section === 'middle')
    const topRows = rows.filter(r => r.section === 'top')
    const bottomRows = rows.filter(r => r.section === 'bottom')

    home.value = {
      description: blocksToText(parseBlocks(middle?.content ?? null)) || undefined,
      topCards: topRows.map(rowToCard),
      bottomCards: bottomRows.map(rowToCard),
    }
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

/* ── Status ─────────────────────────────────────────────────── */
.status {
  padding: 48px 24px;
  text-align: center;
  font-size: 13px;
  color: var(--color-muted);
}
.error { color: var(--color-red); }

/* ── Intro ──────────────────────────────────────────────────── */
.intro {
  padding: 32px 24px 16px;
  max-width: 720px;
  margin: 0 auto;
}

.intro-text {
  font-size: 15px;
  line-height: 1.75;
  color: var(--color-text);
  white-space: pre-line;
}

/* ── Card section ───────────────────────────────────────────── */
.card-section {
  padding: 16px 16px 0;
  max-width: 960px;
  margin: 0 auto;
}

.card-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
  padding-bottom: 16px;
}

@media (min-width: 600px) {
  .card-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

/* ── Card ───────────────────────────────────────────────────── */
.card {
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
  height: 100%;
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

.card-desc {
  margin: 0;
}

.card-desc :deep(p) {
  margin: 0 0 0.75em;
  line-height: 1.7;
  font-size: 13px;
  color: var(--color-muted);
}

.card-desc :deep(p:last-child) {
  margin-bottom: 0;
}

.card-desc :deep(strong) {
  font-weight: 500;
  color: var(--color-text);
}

.card-desc :deep(u) {
  text-decoration: underline;
}

.card-desc :deep(em) {
  font-style: italic;
}

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
</style>
