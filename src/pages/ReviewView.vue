<template>
  <div class="review-page">
    <div class="page-header">
      <h1 class="page-title">
        Gjennomgang
        <span v-if="pendingCount > 0" class="pending-badge">{{ pendingCount }}</span>
      </h1>
      <p class="page-subtitle">Uavklarte treff og manglende personer fra dataimport</p>
    </div>

    <!-- Filter tabs -->
    <div class="filter-row">
      <button
        v-for="f in FILTERS"
        :key="f.id"
        class="filter-btn"
        :class="{ active: activeFilter === f.id }"
        @click="activeFilter = f.id"
      >
        {{ f.label }}
        <span v-if="f.count > 0" class="filter-count">{{ f.count }}</span>
      </button>
    </div>

    <div v-if="loading" class="status">Laster…</div>
    <div v-else-if="error" class="status error">Kunne ikke laste gjennomgangsdata.</div>
    <div v-else-if="filteredItems.length === 0" class="status">Ingen elementer å vise.</div>

    <template v-else>
      <!-- Group by operation -->
      <div v-for="group in groupedItems" :key="group.operation" class="op-group">
        <div class="op-heading">
          <span class="op-name">{{ group.operation }}</span>
          <span class="op-count">{{ group.items.length }}</span>
        </div>

        <div class="item-list">
          <div
            v-for="item in group.items"
            :key="item.id"
            class="review-item"
            :class="`item--${item.status}`"
          >
            <div class="item-main">
              <span class="type-badge" :class="`type--${item.type}`">
                {{ TYPE_LABELS[item.type] ?? item.type }}
              </span>

              <div class="item-names">
                <span class="raw-name">{{ item.rawName }}</span>
                <span class="arrow">→</span>
                <RouterLink
                  v-if="item.resolvedSlug"
                  :to="`/person/${item.resolvedSlug}`"
                  class="resolved-slug"
                >
                  {{ item.resolvedSlug }}
                </RouterLink>
                <span v-else class="resolved-slug unresolved">–</span>
              </div>

              <span v-if="item.codename" class="codename">«{{ item.codename }}»</span>
            </div>

            <div class="item-meta">
              <span class="confidence-tag" :class="`conf--${item.confidence}`">
                {{ CONFIDENCE_LABELS[item.confidence] ?? item.confidence }}
              </span>
              <span v-if="item.reviewedAt" class="reviewed-at">{{ item.reviewedAt }}</span>
            </div>

            <div v-if="item.status === 'pending'" class="item-actions">
              <button class="action-btn approve" :disabled="saving === item.id" @click="setStatus(item, 'approved')">
                Godkjenn
              </button>
              <button class="action-btn reject" :disabled="saving === item.id" @click="setStatus(item, 'rejected')">
                Avvis
              </button>
            </div>
            <div v-else class="item-resolved-label" :class="`resolved--${item.status}`">
              {{ item.status === 'approved' ? 'Godkjent' : 'Avvist' }}
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { neo4jQuery } from '../composables/useNeo4j.ts'

interface ReviewItem {
  id:           string
  type:         'missing_person' | 'fuzzy_match' | 'location_variant'
  status:       'pending' | 'approved' | 'rejected'
  rawName:      string
  resolvedSlug: string
  operation:    string
  eventSlug:    string
  codename:     string | null
  confidence:   string
  createdAt:    string | null
  reviewedAt:   string | null
}

const TYPE_LABELS: Record<string, string> = {
  missing_person:    'Mangler i Sanity',
  fuzzy_match:       'Usikker treff',
  location_variant:  'Stedsnavn-variant',
}

const CONFIDENCE_LABELS: Record<string, string> = {
  'auto-generated': 'Autogenerert',
  'last-word':      'Etternavn-treff',
  'initial':        'Initial-treff',
  'high':           'Sikkert',
  'probable':       'Sannsynlig',
  'review':         'Krever sjekk',
}

const FILTERS = computed(() => [
  { id: 'all',      label: 'Alle',     count: items.value.length },
  { id: 'pending',  label: 'Venter',   count: items.value.filter(i => i.status === 'pending').length },
  { id: 'approved', label: 'Godkjent', count: items.value.filter(i => i.status === 'approved').length },
  { id: 'rejected', label: 'Avvist',   count: items.value.filter(i => i.status === 'rejected').length },
])

const pendingCount = computed(() => items.value.filter(i => i.status === 'pending').length)

const items       = ref<ReviewItem[]>([])
const loading     = ref(true)
const error       = ref(false)
const saving      = ref<string | null>(null)
const activeFilter = ref<'all' | 'pending' | 'approved' | 'rejected'>('pending')

const filteredItems = computed(() =>
  activeFilter.value === 'all'
    ? items.value
    : items.value.filter(i => i.status === activeFilter.value),
)

const groupedItems = computed(() => {
  const map = new Map<string, ReviewItem[]>()
  for (const item of filteredItems.value) {
    const list = map.get(item.operation) ?? []
    list.push(item)
    map.set(item.operation, list)
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([operation, items]) => ({ operation, items }))
})

onMounted(async () => {
  try {
    const rows = await neo4jQuery<ReviewItem>(
      `MATCH (ri:ReviewItem)
       RETURN ri.id           AS id,
              ri.type         AS type,
              ri.status       AS status,
              ri.rawName      AS rawName,
              ri.resolvedSlug AS resolvedSlug,
              ri.operation    AS operation,
              ri.eventSlug    AS eventSlug,
              ri.codename     AS codename,
              ri.confidence   AS confidence,
              ri.createdAt    AS createdAt,
              ri.reviewedAt   AS reviewedAt
       ORDER BY ri.status ASC, ri.operation ASC, ri.rawName ASC`,
    )
    items.value = rows
  } catch {
    error.value = true
  } finally {
    loading.value = false
  }
})

async function setStatus(item: ReviewItem, status: 'approved' | 'rejected') {
  saving.value = item.id
  try {
    const res = await fetch('/api/review-item', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id: item.id, status }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as { reviewedAt: string }
    item.status     = status
    item.reviewedAt = data.reviewedAt
  } finally {
    saving.value = null
  }
}
</script>

<style scoped>
.review-page {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: var(--color-bg);
}

/* ── Header ─────────────────────────────────────────────────── */
.page-header {
  padding: 20px 16px 12px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.page-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text);
  margin: 0 0 4px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.pending-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  background: var(--color-navy);
  border-radius: 11px;
}

.page-subtitle {
  font-size: 12px;
  color: var(--color-muted);
  margin: 0;
}

/* ── Filter row ─────────────────────────────────────────────── */
.filter-row {
  display: flex;
  gap: 4px;
  padding: 10px 16px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  overflow-x: auto;
}

.filter-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-muted);
  background: none;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 5px 10px;
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.1s, border-color 0.1s, background 0.1s;
}

.filter-btn:hover {
  color: var(--color-text);
  border-color: var(--color-border-mid);
}

.filter-btn.active {
  color: var(--color-navy);
  border-color: var(--color-navy);
  background: var(--color-bg);
  font-weight: 600;
}

.filter-count {
  font-size: 10px;
  font-weight: 700;
  color: var(--color-muted);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 0 5px;
  min-width: 16px;
  text-align: center;
}

.filter-btn.active .filter-count {
  color: var(--color-navy);
  border-color: var(--color-navy);
}

/* ── Status ─────────────────────────────────────────────────── */
.status {
  padding: 48px 24px;
  text-align: center;
  font-size: 13px;
  color: var(--color-muted);
}
.error { color: var(--color-red, #c0392b); }

/* ── Operation group ────────────────────────────────────────── */
.op-group {
  margin: 0;
}

.op-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: 0;
  z-index: 1;
}

.op-name {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--color-muted);
}

.op-count {
  font-size: 10px;
  color: var(--color-muted);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 0 5px;
}

/* ── Review item ────────────────────────────────────────────── */
.item-list {
  display: flex;
  flex-direction: column;
}

.review-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
  flex-wrap: wrap;
  transition: background 0.1s;
}

.review-item:last-child {
  border-bottom: none;
}

.item--approved { opacity: 0.55; }
.item--rejected { opacity: 0.4; }

.item-main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  flex-wrap: wrap;
}

/* ── Type badge ─────────────────────────────────────────────── */
.type-badge {
  flex-shrink: 0;
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 2px 6px;
  border-radius: 3px;
  white-space: nowrap;
}

.type--missing_person   { color: #7a4f00; background: #fff3cd; border: 1px solid #f0c040; }
.type--fuzzy_match      { color: #1a4f7a; background: #d6eaf8; border: 1px solid #7fb3d3; }
.type--location_variant { color: #2e7d4f; background: #d5f5e3; border: 1px solid #7dcea0; }

/* ── Names ──────────────────────────────────────────────────── */
.item-names {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  flex-wrap: wrap;
}

.raw-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  white-space: nowrap;
}

.arrow {
  font-size: 11px;
  color: var(--color-muted);
  flex-shrink: 0;
}

.resolved-slug {
  font-size: 11px;
  color: var(--color-navy);
  text-decoration: none;
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.resolved-slug:hover { text-decoration: underline; }
.resolved-slug.unresolved { color: var(--color-muted); font-family: inherit; }

.codename {
  font-size: 11px;
  color: var(--color-muted);
  font-style: italic;
  white-space: nowrap;
  flex-shrink: 0;
}

/* ── Meta ───────────────────────────────────────────────────── */
.item-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.confidence-tag {
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 2px 5px;
  border-radius: 3px;
  white-space: nowrap;
}

.conf--auto-generated { color: var(--color-muted); background: var(--color-bg); border: 1px solid var(--color-border); }
.conf--last-word      { color: #6c3483; background: #f5eef8; border: 1px solid #c39bd3; }
.conf--initial        { color: #6c3483; background: #f5eef8; border: 1px solid #c39bd3; }
.conf--high           { color: #1e8449; background: #eafaf1; border: 1px solid #82e0aa; }
.conf--probable       { color: #1a4f7a; background: #d6eaf8; border: 1px solid #7fb3d3; }
.conf--review         { color: #7a4f00; background: #fff3cd; border: 1px solid #f0c040; }

.reviewed-at {
  font-size: 10px;
  color: var(--color-muted);
}

/* ── Actions ────────────────────────────────────────────────── */
.item-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.action-btn {
  font-size: 11px;
  font-weight: 600;
  padding: 5px 12px;
  border-radius: 4px;
  cursor: pointer;
  border: 1px solid;
  transition: opacity 0.1s;
  touch-action: manipulation;
}

.action-btn:disabled { opacity: 0.4; cursor: default; }

.action-btn.approve {
  color: #1e8449;
  border-color: #82e0aa;
  background: #eafaf1;
}
.action-btn.approve:hover:not(:disabled) {
  background: #d5f5e3;
}

.action-btn.reject {
  color: var(--color-muted);
  border-color: var(--color-border);
  background: var(--color-bg);
}
.action-btn.reject:hover:not(:disabled) {
  color: var(--color-text);
  border-color: var(--color-border-mid);
}

.item-resolved-label {
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}

.resolved--approved { color: #1e8449; }
.resolved--rejected { color: var(--color-muted); }

@media (max-width: 480px) {
  .item-actions {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>
