<template>
  <aside class="drawer">
    <!-- Back bar — visible whenever a detail is open -->
    <button v-if="onBack" class="back-bar" @click="onBack">
      <span class="back-arrow">‹</span> Tilbake til listen
    </button>

    <!-- Row 1: identity — count + title + Kartoversikt -->
    <div class="header-identity">
      <div class="handle"></div>
      <span v-if="titleCount !== undefined" class="title-badge">{{ titleCount }}</span>
      <button
        v-if="onOverview"
        class="overview-btn-header"
        title="Vis hele kartet"
        @click="onOverview"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
        Kartoversikt
      </button>
      <button
        v-if="onNearest"
        class="overview-btn-header"
        title="Nærmeste steder"
        @click="onNearest"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <circle cx="12" cy="12" r="9" />
          <line x1="12" y1="2" x2="12" y2="6" />
          <line x1="12" y1="18" x2="12" y2="22" />
          <line x1="2" y1="12" x2="6" y2="12" />
          <line x1="18" y1="12" x2="22" y2="12" />
        </svg>
        Nærmeste
      </button>
      <button
        v-if="onFilter"
        class="overview-btn-header filter-btn"
        :class="{ 'filter-active': filterActive }"
        title="Filter"
        @click="onFilter"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="4" y1="6" x2="20" y2="6" />
          <line x1="8" y1="12" x2="16" y2="12" />
          <line x1="11" y1="18" x2="13" y2="18" />
        </svg>
        Filter
      </button>
    </div>

    <!-- Search indicator bar -->
    <div v-if="searchLabel" class="search-bar">
      <span class="search-bar-label">Søk: {{ searchLabel }}</span>
      <button v-if="onClearSearch" class="search-bar-clear" @click="onClearSearch">✕</button>
    </div>

    <!-- Row 2: navigation — pagination only -->
    <div v-if="pageCount > 1 && !onBack" class="header-nav">
      <!-- Mobile: swipeable dots -->
      <PageDots
        class="mobile-pager"
        :current="page"
        :total="pageCount"
        @change="page = $event"
      />
      <!-- Desktop: prev / counter / next -->
      <div class="desktop-pager">
        <button class="pager-btn" :disabled="page === 0" @click="page--">← Forrige</button>
        <span class="pager-counter">Side {{ page + 1 }} av {{ pageCount }}</span>
        <button class="pager-btn" :disabled="page === pageCount - 1" @click="page++">Neste →</button>
      </div>
    </div>

    <div
      class="cards"
      @touchstart="onTouchStart"
      @touchend="onTouchEnd"
    >
      <slot :page="page"></slot>
    </div>
  </aside>

  <!-- Filter — mobile: floating button above drawer, right side -->
  <button
    v-if="onFilter"
    class="overview-btn-float filter-btn-float"
    :class="{ 'filter-active': filterActive }"
    title="Filter"
    @click="onFilter"
  >
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="8" y1="12" x2="16" y2="12" />
      <line x1="11" y1="18" x2="13" y2="18" />
    </svg>
  </button>

  <!-- Kartoversikt — mobile: floating button above drawer, left side -->
  <button
    v-if="onOverview"
    class="overview-btn-float"
    title="Vis hele kartet"
    @click="onOverview"
  >
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  </button>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import PageDots from './PageDots.vue'

defineProps<{
  title: string
  titleCount?: number
  pageCount: number
  onBack?: () => void
  onOverview?: () => void
  onNearest?: () => void
  onFilter?: () => void
  filterActive?: boolean
  searchLabel?: string
  onClearSearch?: () => void
}>()

const page = ref(0)

let touchStartX = 0
function onTouchStart(e: TouchEvent) {
  touchStartX = e.touches[0].clientX
}
function onTouchEnd(e: TouchEvent) {
  const dx = e.changedTouches[0].clientX - touchStartX
  if (Math.abs(dx) < 40) return
}

defineExpose({
  page,
  resetPage: () => { page.value = 0 },
})
</script>

<style scoped>
.drawer {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: var(--drawer-height);
  background: var(--color-surface);
  border-top: 2px solid var(--color-border);
  display: flex;
  flex-direction: column;
  z-index: 10;
}

@media (min-width: 768px) {
  .drawer {
    top: var(--nav-height);
    left: 0;
    right: auto;
    bottom: auto;
    width: var(--sidebar-width);
    max-width: 360px;
    height: calc(100vh - var(--nav-height));
    border-top: none;
    border-right: 2px solid var(--color-border);
  }
}

/* Search indicator bar */
.search-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 14px;
  background: var(--color-bg);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
  gap: 8px;
}
.search-bar-label {
  font-size: 12px;
  color: var(--color-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.search-bar-clear {
  background: none;
  border: none;
  font-size: 11px;
  color: var(--color-muted);
  cursor: pointer;
  flex-shrink: 0;
  padding: 2px 4px;
  border-radius: 3px;
  transition: background 0.1s;
}
.search-bar-clear:hover { background: var(--color-border); color: var(--color-text); }

/* Back bar */
.back-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 9px 14px 8px;
  background: var(--color-bg);
  border: none;
  border-bottom: 1px solid var(--color-border);
  font-size: 13px;
  font-weight: 600;
  color: var(--color-navy);
  cursor: pointer;
  text-align: left;
  flex-shrink: 0;
  transition: background 0.1s;
}
.back-bar:hover { background: var(--color-border); }
.back-arrow {
  font-size: 17px;
  line-height: 1;
  margin-top: -1px;
}

/* ── Row 1: identity ─────────────────────────────────────────── */
.header-identity {
  display: flex;
  align-items: center;
  padding: 12px 14px 6px;
  gap: 8px;
  flex-shrink: 0;
}

.handle {
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: var(--color-handle);
  flex-shrink: 0;
  margin-right: 2px;
}
@media (min-width: 768px) { .handle { display: none; } }

.title-badge {
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  padding: 1px 5px;
  flex-shrink: 0;
}

.drawer-title {
  flex: 1;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

/* ── Row 2: navigation ───────────────────────────────────────── */
.header-nav {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px 14px 8px;
  border-bottom: 0.5px solid var(--color-border);
  flex-shrink: 0;
}

/* ── Kartoversikt button ─────────────────────────────────────── */

/* Desktop header version — hidden on mobile */
.overview-btn-header {
  display: none;
}
@media (min-width: 768px) {
  .overview-btn-header {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
    background: none;
    border: 1px solid var(--color-border-mid);
    border-radius: 4px;
    padding: 3px 8px;
    font-size: 12px;
    font-weight: 600;
    color: var(--color-navy);
    cursor: pointer;
    transition: background 0.1s, border-color 0.1s;
  }
  .overview-btn-header:hover {
    background: var(--color-bg);
    border-color: var(--color-navy);
  }
}

.filter-btn.filter-active {
  background: var(--color-navy);
  color: #fff;
  border-color: var(--color-navy);
}

/* Mobile floating version — hidden on desktop */
.overview-btn-float {
  display: flex;
  align-items: center;
  justify-content: center;
  position: fixed;
  bottom: calc(var(--drawer-height) + 12px);
  left: 12px;
  width: 40px;
  height: 40px;
  background: var(--color-surface);
  border: 1px solid var(--color-border-mid);
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.12);
  cursor: pointer;
  z-index: 11;
  color: var(--color-navy);
  transition: background 0.1s;
}
.overview-btn-float:hover { background: var(--color-bg); }
.filter-btn-float {
  left: auto;
  right: 12px;
}
.filter-btn-float.filter-active {
  background: var(--color-navy);
  color: #fff;
  border-color: var(--color-navy);
}

@media (min-width: 768px) {
  .overview-btn-float { display: none; }
}

/* Mobile: show dots, hide text pager */
.mobile-pager  { display: flex; }
.desktop-pager { display: none; }

@media (min-width: 768px) {
  .mobile-pager  { display: none; }
  .desktop-pager {
    display: flex;
    align-items: center;
    gap: 8px;
  }
}

.pager-btn {
  background: none;
  border: none;
  padding: 2px 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-muted);
  cursor: pointer;
  border-radius: 3px;
  transition: background 0.1s;
}
.pager-btn:hover:not(:disabled) { background: var(--color-bg); }
.pager-btn:disabled {
  color: var(--color-handle);
  cursor: default;
}

.pager-counter {
  font-size: 11px;
  color: var(--color-muted);
  white-space: nowrap;
}

.cards {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: 10px 10px 0;
  gap: 6px;
}

/* When showing detail view, strip the padding so DetailView owns its own layout */
.cards:has(.detail) {
  padding: 0;
  gap: 0;
}
</style>
