<template>
  <div class="page-header">
    <RouterLink to="/registre" class="back-link">&#x2039; Tilbake</RouterLink>
    <h1 class="unit-name">{{ name }}</h1>
    <p v-if="formalName" class="unit-meta">{{ formalName }}</p>
    <p v-if="foundedDate || dissolvedDate || country" class="unit-period">
      <span v-if="foundedDate || dissolvedDate">
        Etablert {{ foundedDate ?? '?' }}<span v-if="dissolvedDate"> – {{ dissolvedDate }}</span>
      </span>
      <span v-if="country" class="unit-country">{{ country }}</span>
    </p>
    <div v-if="parents.length" class="parent-list">
      <div v-for="p in parents" :key="p.slug" class="parent-row">
        <RouterLink :to="parentRoute(p)" class="parent-link">
          <span v-if="p.color" class="color-dot" :style="{ background: p.color }"></span>
          {{ p.name }}
        </RouterLink>
        <span v-if="p.role" class="parent-role"><RoleLabel :role-key="p.role" /></span>
        <button
          v-if="p.description"
          class="info-marker"
          type="button"
          :aria-expanded="expandedParent === p.slug"
          aria-label="Vis forklaring"
          @click="toggleParentInfo(p.slug)"
        >
          i
        </button>
        <div v-if="p.description && expandedParent === p.slug" class="parent-desc">
          <p class="parent-desc-text">{{ p.description }}</p>
          <SourceRef v-if="p.sourceRefs?.length" :refs="p.sourceRefs" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * UnitHeader — back link + name + formal name + founded/dissolved period
 * + country pill + parent (PART_OF) list with role + info marker.
 *
 * Parents stay in the header (above the View / Edit tabs) because they
 * frame the unit's identity — a Unit is "this thing under that thing"
 * before it's anything else.
 */
import { ref } from 'vue'
import RoleLabel from '@/components/role/RoleLabel.vue'
import { RouterLink } from 'vue-router'
import SourceRef from '@/components/SourceRef.vue'
import type { UnitParent } from '@/composables/useUnitData.ts'

defineProps<{
  name:           string
  formalName?:    string | null
  foundedDate?:   string | null
  dissolvedDate?: string | null
  country?:       string | null
  parents:        UnitParent[]
}>()


const expandedParent = ref<string | null>(null)
function toggleParentInfo(slug: string) {
  expandedParent.value = expandedParent.value === slug ? null : slug
}
function parentRoute(p: UnitParent): string {
  return p.label === 'Organization' ? `/organization/${p.slug}` : `/district/${p.slug}`
}
</script>

<style scoped>
.page-header {
  padding: 14px 16px 12px;
  background: var(--paper-raised);
  border-bottom: 1px solid var(--rule);
}
.back-link {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  font-size: 13px;
  font-weight: 600;
  color: var(--focus);
  text-decoration: none;
  margin-bottom: 6px;
}
.back-link:hover { text-decoration: underline; }
.unit-name {
  font-size: 22px;
  font-weight: 700;
  color: var(--ink);
  margin: 0 0 4px;
  line-height: 1.25;
  overflow-wrap: break-word;
}
.unit-meta {
  font-size: 13px;
  color: var(--muted);
  margin: 0 0 6px;
  font-style: italic;
}
.unit-period {
  font-size: 12px;
  color: var(--muted);
  margin: 0 0 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-variant-numeric: tabular-nums;
}
.unit-country {
  display: inline-block;
  padding: 1px 6px;
  border: 1px solid var(--rule);
  border-radius: 3px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
}
.parent-list { display: flex; flex-direction: column; gap: 2px; margin-top: 4px; }
.parent-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.parent-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--focus);
  text-decoration: none;
}
.parent-link:hover { text-decoration: underline; }
.parent-role {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
  padding: 1px 6px;
  border: 1px solid var(--rule);
  border-radius: 3px;
}
.info-marker {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid var(--rule);
  background: var(--paper-raised);
  color: var(--muted);
  font-size: 11px;
  font-weight: 700;
  font-style: italic;
  line-height: 1;
  cursor: pointer;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.1s, border-color 0.1s, color 0.1s;
  -webkit-tap-highlight-color: transparent;
}
.info-marker:hover,
.info-marker[aria-expanded="true"] {
  background: var(--focus);
  border-color: var(--focus);
  color: #fff;
}
.parent-desc {
  flex-basis: 100%;
  margin: 4px 0 2px;
  padding: 8px 10px;
  background: var(--paper);
  border-left: 3px solid var(--focus);
  border-radius: 0 3px 3px 0;
}
.parent-desc-text {
  margin: 0 0 4px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--ink);
}
.parent-desc-text:last-child { margin-bottom: 0; }
.color-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
</style>
