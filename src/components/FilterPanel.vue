<template>
  <Teleport to="body">
    <div v-show="open" class="filter-backdrop" @click="$emit('close')"></div>
    <div class="filter-panel" :class="{ open }">
      <div class="panel-header">
        <span class="panel-title">Filter</span>
        <button class="close-btn" @click="$emit('close')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div class="panel-body">
        <!-- Organisasjoner -->
        <section class="filter-section">
          <div class="section-label">Organisasjoner</div>
          <!-- Desktop: chips -->
          <div class="chips desktop-only">
            <button
              v-for="org in orgs" :key="org"
              class="chip"
              :class="{ active: activeOrgs.includes(org) }"
              :style="activeOrgs.includes(org)
                ? { background: orgColors[org] ?? '#1e3a5f', borderColor: orgColors[org] ?? '#1e3a5f', color: '#fff' }
                : { borderColor: orgColors[org] ?? '#d4c9b0', color: orgColors[org] ?? '#8a7a60' }"
              :title="org"
              @click="toggleOrg(org)"
            >
              {{ org }}
            </button>
          </div>
          <!-- Mobile: trigger + dropdown -->
          <div class="mobile-only">
            <button class="select-trigger" :class="{ active: activeOrgs.length > 0 }" @click="orgsOpen = !orgsOpen">
              <span>{{ activeOrgs.length > 0 ? `${activeOrgs.length} valgt` : 'Alle organisasjoner' }}</span>
              <svg class="chevron" :class="{ rotated: orgsOpen }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            <div v-show="orgsOpen" class="check-list">
              <label v-for="org in orgs" :key="org" class="check-row">
                <input type="checkbox" :checked="activeOrgs.includes(org)" @change="toggleOrg(org)" />
                <span>{{ org }}</span>
              </label>
            </div>
          </div>
        </section>

        <!-- Distrikter -->
        <section class="filter-section">
          <div class="section-label">Distrikter</div>
          <!-- Desktop: chips -->
          <div class="chips desktop-only">
            <button
              v-for="d in districts" :key="d"
              class="chip"
              :class="{ active: activeDistricts.includes(d) }"
              :style="activeDistricts.includes(d)
                ? { background: districtColors[d] ?? '#1e3a5f', borderColor: districtColors[d] ?? '#1e3a5f', color: '#fff' }
                : { borderColor: districtColors[d] ?? '#d4c9b0', color: districtColors[d] ?? '#8a7a60' }"
              :title="d"
              @click="toggleDistrict(d)"
            >
              {{ d }}
            </button>
          </div>
          <!-- Mobile: trigger + dropdown -->
          <div class="mobile-only">
            <button class="select-trigger" :class="{ active: activeDistricts.length > 0 }" @click="districtsOpen = !districtsOpen">
              <span>{{ activeDistricts.length > 0 ? `${activeDistricts.length} valgt` : 'Alle distrikter' }}</span>
              <svg class="chevron" :class="{ rotated: districtsOpen }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            <div v-show="districtsOpen" class="check-list">
              <label v-for="d in districts" :key="d" class="check-row">
                <input type="checkbox" :checked="activeDistricts.includes(d)" @change="toggleDistrict(d)" />
                <span>{{ d }}</span>
              </label>
            </div>
          </div>
        </section>

        <!-- Søk -->
        <section class="filter-section">
          <div class="section-label">Søk</div>
          <input
            v-model="localSearch"
            class="search-input"
            type="search"
            placeholder="Søk…"
            @keydown.enter="commitSearch"
          />
          <div class="search-types">
            <label class="toggle-row">
              <input type="checkbox" :checked="searchInLocations" @change="$emit('update:searchInLocations', ($event.target as HTMLInputElement).checked)" />
              <span>Lokasjoner</span>
            </label>
            <label class="toggle-row">
              <input type="checkbox" :checked="searchInStations" @change="$emit('update:searchInStations', ($event.target as HTMLInputElement).checked)" />
              <span>Stasjoner</span>
            </label>
            <label class="toggle-row">
              <input type="checkbox" :checked="searchInEvents" @change="$emit('update:searchInEvents', ($event.target as HTMLInputElement).checked)" />
              <span>Hendelser</span>
            </label>
            <label class="toggle-row">
              <input type="checkbox" :checked="searchInPeople" @change="$emit('update:searchInPeople', ($event.target as HTMLInputElement).checked)" />
              <span>Personer</span>
            </label>
          </div>
          <button class="search-btn" @click="commitSearch">Søk</button>
          <div v-if="noResults" class="no-results">Ingen resultater funnet</div>
        </section>

        <hr class="divider" />

        <!-- Visningsfilter -->
        <section class="filter-section">
          <div class="section-label">Visningsfilter</div>
          <label class="toggle-row">
            <input
              type="checkbox"
              :checked="showLocations"
              @change="$emit('update:showLocations', ($event.target as HTMLInputElement).checked)"
            />
            <span>Lokasjoner</span>
          </label>
          <label class="toggle-row">
            <input
              type="checkbox"
              :checked="showStations"
              @change="$emit('update:showStations', ($event.target as HTMLInputElement).checked)"
            />
            <span>Stasjoner</span>
          </label>
        </section>

        <hr class="divider" />

        <section class="filter-section">
          <button class="reset-btn" @click="$emit('reset')">Nullstill filter</button>
        </section>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{
  open: boolean
  orgs: string[]
  districts: string[]
  orgColors: Record<string, string>
  districtColors: Record<string, string>
  activeOrgs: string[]
  activeDistricts: string[]
  searchText: string
  searchInLocations: boolean
  searchInStations: boolean
  searchInEvents: boolean
  searchInPeople: boolean
  showLocations: boolean
  showStations: boolean
  noResults?: boolean
}>()

const emit = defineEmits<{
  close: []
  reset: []
  search: []
  'update:activeOrgs': [value: string[]]
  'update:activeDistricts': [value: string[]]
  'update:searchText': [value: string]
  'update:searchInLocations': [value: boolean]
  'update:searchInStations': [value: boolean]
  'update:searchInEvents': [value: boolean]
  'update:searchInPeople': [value: boolean]
  'update:showLocations': [value: boolean]
  'update:showStations': [value: boolean]
}>()

const orgsOpen = ref(false)
const districtsOpen = ref(false)
const localSearch = ref(props.searchText)

// Keep local in sync when parent resets
watch(() => props.searchText, v => { localSearch.value = v })

function commitSearch() {
  emit('update:searchText', localSearch.value)
  emit('search')
}

function toggleOrg(org: string) {
  const next = props.activeOrgs.includes(org)
    ? props.activeOrgs.filter(o => o !== org)
    : [...props.activeOrgs, org]
  emit('update:activeOrgs', next)
}

function toggleDistrict(d: string) {
  const next = props.activeDistricts.includes(d)
    ? props.activeDistricts.filter(x => x !== d)
    : [...props.activeDistricts, d]
  emit('update:activeDistricts', next)
}
</script>

<style scoped>
.filter-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 19;
}

/* Mobile: bottom sheet */
.filter-panel {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 72vh;
  background: var(--color-surface);
  border-top: 2px solid var(--color-border);
  border-radius: 12px 12px 0 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  transform: translateY(100%);
  transition: transform 0.25s ease;
}
.filter-panel.open { transform: translateY(0); }

/* Desktop: left slide-in covering sidebar */
@media (min-width: 768px) {
  .filter-backdrop { left: var(--sidebar-width); }
  .filter-panel {
    top: var(--nav-height);
    left: 0;
    right: auto;
    bottom: auto;
    width: var(--sidebar-width);
    height: calc(100vh - var(--nav-height));
    border-top: none;
    border-right: 2px solid var(--color-border);
    border-radius: 0;
    transform: translateX(-100%);
  }
  .filter-panel.open { transform: translateX(0); }
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 12px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.panel-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--color-text);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.close-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-muted);
  display: flex;
  align-items: center;
  padding: 4px;
  border-radius: 4px;
  transition: background 0.1s, color 0.1s;
}
.close-btn:hover { background: var(--color-bg); color: var(--color-text); }

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 0 0 16px;
}

.filter-section {
  padding: 14px 16px 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--color-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.mobile-only  { display: block; }
.desktop-only { display: none; }
@media (min-width: 768px) {
  .mobile-only  { display: none; }
  .desktop-only { display: flex; flex-wrap: wrap; gap: 6px; }
}

/* Chips (desktop) */
.chip {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 14px;
  border: 1.5px solid;
  background: var(--color-surface);
  cursor: pointer;
  transition: background 0.1s, color 0.1s, border-color 0.1s, opacity 0.1s;
  white-space: nowrap;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chip:hover { opacity: 0.75; }

/* Trigger button */
.select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 8px 12px;
  background: var(--color-bg);
  border: 1px solid var(--color-border-mid);
  border-radius: 6px;
  font-size: 13px;
  color: var(--color-muted);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.1s;
}
.select-trigger:hover { border-color: var(--color-navy); }
.select-trigger.active {
  border-color: var(--color-navy);
  color: var(--color-navy);
  font-weight: 600;
}

.chevron {
  flex-shrink: 0;
  transition: transform 0.2s ease;
  color: var(--color-muted);
}
.chevron.rotated { transform: rotate(180deg); }

/* Checkbox list */
.check-list {
  border: 1px solid var(--color-border);
  border-radius: 6px;
  overflow-y: auto;
  max-height: 200px;
  background: var(--color-surface);
}

.check-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--color-text);
  cursor: pointer;
  border-bottom: 1px solid var(--color-border);
  user-select: none;
  transition: background 0.1s;
}
.check-row:last-child { border-bottom: none; }
.check-row:hover { background: var(--color-bg); }
.check-row input[type='checkbox'] {
  width: 15px;
  height: 15px;
  accent-color: var(--color-navy);
  cursor: pointer;
  flex-shrink: 0;
}

/* Search */
.search-input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--color-border-mid);
  border-radius: 6px;
  font-size: 13px;
  color: var(--color-text);
  background: var(--color-bg);
  outline: none;
  transition: border-color 0.1s;
}
.search-input:focus { border-color: var(--color-navy); }

.search-btn {
  width: 100%;
  margin-top: 8px;
  padding: 10px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text);
  cursor: pointer;
  transition: background 0.1s, border-color 0.1s;
}
.search-btn:hover { background: var(--color-bg); border-color: var(--color-border-mid); }

.no-results {
  font-size: 12px;
  color: var(--color-red);
  text-align: center;
  padding-top: 4px;
}

.search-types {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 12px;
}

.divider {
  border: none;
  border-top: 1px solid var(--color-border);
  margin: 14px 0 0;
}

.toggle-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--color-text);
  cursor: pointer;
  user-select: none;
}
.toggle-row input[type='checkbox'] {
  width: 16px;
  height: 16px;
  accent-color: var(--color-navy);
  cursor: pointer;
  flex-shrink: 0;
}

.reset-btn {
  width: 100%;
  padding: 10px;
  background: var(--color-bg);
  border: 1px solid var(--color-border-mid);
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-muted);
  cursor: pointer;
  transition: background 0.1s, border-color 0.1s;
}
.reset-btn:hover { background: var(--color-border); border-color: var(--color-navy); }
</style>
