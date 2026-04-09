<template>
  <div class="about-page">
    <div v-if="loading" class="status">Laster…</div>
    <div v-else-if="error" class="status">Kunne ikke laste innhold.</div>

    <template v-else>
      <div class="page-header">
        <h1 class="page-title">Om oss</h1>
      </div>

      <!-- Beskrivelse -->
      <section v-if="descriptionHtml" class="section">
        <!-- eslint-disable vue/no-v-html -->
        <div
          class="portable-text"
          @click.capture="handleInternalLinks"
          v-html="descriptionHtml"
        ></div>
        <!-- eslint-enable vue/no-v-html -->
      </section>

      <!-- Støttespillere -->
      <section v-if="partners.length" class="section">
        <h2 class="section-heading">Våre støttespillere</h2>
        <div class="partners-grid">
          <div v-for="p in partners" :key="p.title" class="partner-card">
            <img
              v-if="p.imageUrl"
              :src="`${p.imageUrl}?w=400&auto=format`"
              :alt="p.title"
              class="partner-img"
              loading="lazy"
            />
            <div class="partner-body">
              <h3 class="partner-title">{{ p.title }}</h3>
              <!-- eslint-disable vue/no-v-html -->
              <div
                v-if="p.descriptionHtml"
                class="portable-text partner-desc"
                @click.capture="handleInternalLinks"
                v-html="p.descriptionHtml"
              ></div>
              <!-- eslint-enable vue/no-v-html -->
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
import { SANITY_CDN } from '../config/sanity.ts'
import { blocksToHtml } from '../utils/portableText.ts'

interface Partner {
  title: string
  descriptionHtml?: string
  imageUrl?: string
}

const router = useRouter()
const loading = ref(true)
const error = ref(false)
const descriptionHtml = ref<string | null>(null)
const partners = ref<Partner[]>([])

function handleInternalLinks(e: MouseEvent) {
  const link = (e.target as HTMLElement).closest('a.internal-link')
  if (link) {
    e.preventDefault()
    void router.push(link.getAttribute('href') ?? '/')
  }
}

onMounted(async () => {
  try {
    const query = `{
      "about": *[_type == "aboutUs"][0]{ description },
      "partners": *[_type == "partner"]{ title, description, "imageUrl": image.asset->url }
    }`
    const res = await fetch(`${SANITY_CDN}?query=${encodeURIComponent(query)}`)
    if (!res.ok) throw new Error(`${res.status}`)
    const data = await res.json()
    const result = data.result as {
      about?: { description?: unknown }
      partners?: { title?: string; description?: unknown; imageUrl?: string }[]
    } | null
    if (!result) { error.value = true; return }

    const html = blocksToHtml(result.about?.description)
    descriptionHtml.value = html || null

    partners.value = (result.partners ?? []).map(p => ({
      title: p.title ?? '',
      descriptionHtml: blocksToHtml(p.description) || undefined,
      imageUrl: p.imageUrl,
    }))
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
  display: flex;
  flex-direction: column;
  align-items: center;
}

.about-page > * {
  width: 100%;
  max-width: 1320px;
}

.status {
  padding: 48px 20px;
  text-align: center;
  font-size: 13px;
  color: var(--color-muted);
}

.page-header {
  padding: 24px 16px 16px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.page-title {
  font-size: 26px;
  font-weight: 700;
  color: var(--color-navy);
  margin: 0;
}

.section {
  padding: 20px 16px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
}

.section-heading {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--color-muted);
  margin: 0 0 16px;
}

/* ── Portable text ───────────────────────────────────────────── */
.portable-text :deep(p) {
  margin: 0 0 0.75em;
  font-size: 14px;
  line-height: 1.75;
  color: var(--color-text);
}
.portable-text :deep(p:last-child) { margin-bottom: 0; }
.portable-text :deep(strong) { font-weight: 600; }
.portable-text :deep(em) { font-style: italic; }
.portable-text :deep(a.internal-link),
.portable-text :deep(a.external-link) {
  color: var(--color-navy);
  text-decoration: underline;
  cursor: pointer;
}
.portable-text :deep(a.external-link::after) {
  content: ' ↗';
  font-size: 11px;
  opacity: 0.6;
}

/* ── Partners ────────────────────────────────────────────────── */
.partners-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
}

.partner-card {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--color-bg);
}

.partner-img {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: contain;
  object-position: center;
  display: block;
  background-color: white;
  padding: 16px;
  box-sizing: border-box;
}

.partner-body {
  padding: 12px 14px;
}

.partner-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--color-text);
  margin: 0 0 8px;
}

.partner-desc :deep(p) {
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-muted);
  margin: 0 0 0.5em;
}
.partner-desc :deep(p:last-child) { margin-bottom: 0; }
</style>
