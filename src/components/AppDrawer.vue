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
  background: var(--paper-raised);
  border-top: 2px solid var(--rule);
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
    border-right: 2px solid var(--rule);
  }
}

/* Search indicator bar */
.search-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-xs) var(--space-md);
  background: var(--paper-sunken);
  border-bottom: 1px solid var(--rule);
  flex-shrink: 0;
  gap: var(--space-sm);
}
.search-bar-label {
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.search-bar-clear {
  background: none;
  border: none;
  font-size: var(--size-caps);
  color: var(--muted);
  cursor: pointer;
  flex-shrink: 0;
  padding: var(--space-xs);
  border-radius: var(--radius-md);
  transition: background 120ms ease-out;
}
.search-bar-clear:hover { background: var(--paper); color: var(--faded-red); }

/* Back bar */
.back-bar {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  width: 100%;
  padding: var(--space-sm) var(--space-md);
  background: var(--paper-sunken);
  border: none;
  border-bottom: 1px solid var(--rule);
  font-family: var(--font-sans);
  font-size: var(--size-label);
  font-weight: 500;
  color: var(--ink);
  cursor: pointer;
  text-align: left;
  flex-shrink: 0;
  transition: background 120ms ease-out;
}
.back-bar:hover { background: var(--paper); color: var(--faded-red); }
.back-arrow {
  font-size: var(--size-h3);
  line-height: 1;
  margin-top: -1px;
}

/* ── Row 1: identity ─────────────────────────────────────────── */
.header-identity {
  display: flex;
  align-items: center;
  padding: var(--space-sm) var(--space-md) var(--space-xs);
  gap: var(--space-sm);
  flex-shrink: 0;
}

.handle {
  width: 36px;
  height: 4px;
  border-radius: var(--radius-pill);
  background: var(--rule);
  flex-shrink: 0;
  margin-right: var(--space-xs);
}
@media (min-width: 768px) { .handle { display: none; } }

.title-badge {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  color: var(--ink-soft);
  background: var(--paper-sunken);
  border-radius: var(--radius-pill);
  padding: var(--space-xs) var(--space-sm);
  flex-shrink: 0;
}

.drawer-title {
  flex: 1;
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: var(--tracking-caps);
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
  padding: var(--space-xs) var(--space-md) var(--space-sm);
  border-bottom: 1px solid var(--rule);
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
    gap: var(--space-xs);
    flex-shrink: 0;
    background: transparent;
    border: 1px solid var(--rule);
    border-radius: var(--radius-md);
    padding: var(--space-xs) var(--space-sm);
    font-family: var(--font-sans);
    font-size: var(--size-label);
    font-weight: 500;
    color: var(--ink);
    cursor: pointer;
    transition: background 120ms ease-out, border-color 120ms ease-out;
  }
  .overview-btn-header:hover {
    background: var(--paper-sunken);
  }
}

.filter-btn.filter-active {
  background: var(--ink);
  color: var(--paper);
  border-color: var(--ink);
}

/* Mobile floating version — hidden on desktop */
.overview-btn-float {
  display: flex;
  align-items: center;
  justify-content: center;
  position: fixed;
  bottom: calc(var(--drawer-height) + var(--space-md));
  left: var(--space-md);
  width: 40px;
  height: 40px;
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  z-index: 11;
  color: var(--ink);
  transition: background 120ms ease-out;
}
.overview-btn-float:hover { background: var(--paper-sunken); }
.filter-btn-float {
  left: auto;
  right: var(--space-md);
}
.filter-btn-float.filter-active {
  background: var(--ink);
  color: var(--paper);
  border-color: var(--ink);
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
    gap: var(--space-sm);
  }
}

.pager-btn {
  background: none;
  border: none;
  padding: var(--space-xs) var(--space-sm);
  font-family: var(--font-sans);
  font-size: var(--size-label);
  font-weight: 500;
  color: var(--ink-soft);
  cursor: pointer;
  border-radius: var(--radius-md);
  transition: background 120ms ease-out;
}
.pager-btn:hover:not(:disabled) { background: var(--paper-sunken); color: var(--faded-red); }
.pager-btn:disabled {
  color: var(--rule);
  cursor: default;
}

.pager-counter {
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--muted);
  white-space: nowrap;
}

.cards {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: var(--space-sm) var(--space-sm) 0;
  gap: var(--space-sm);
}

/* When showing detail view, strip the padding so DetailView owns its own layout */
.cards:has(.detail) {
  padding: 0;
  gap: 0;
}
</style>
