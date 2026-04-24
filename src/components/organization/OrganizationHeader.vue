<template>
  <div class="page-header">
    <RouterLink to="/registre" class="back-link">&#x2039; Tilbake</RouterLink>
    <div class="org-title-row">
      <span v-if="color" class="color-dot" :style="{ background: color }"></span>
      <h1 class="org-name">{{ name }}</h1>
      <span v-if="abbreviation && abbreviation !== name" class="abbr-badge">{{ abbreviation }}</span>
    </div>
    <p v-if="formalName" class="org-meta">{{ formalName }}</p>
    <p v-if="foundedDate || dissolvedDate || country" class="org-period">
      <span v-if="foundedDate || dissolvedDate">
        Etablert {{ foundedDate || '?' }}<span v-if="dissolvedDate"> – {{ dissolvedDate }}</span>
      </span>
      <span v-if="country" class="org-country">{{ country }}</span>
    </p>
  </div>
</template>

<script setup lang="ts">
/**
 * OrganizationHeader — back link + name + abbreviation badge + formal
 * name + founded/dissolved period + country pill. Sits at the page top
 * above the View / Edit tabs.
 */
import { RouterLink } from 'vue-router'

defineProps<{
  name:           string
  abbreviation?:  string | null
  formalName?:    string | null
  color?:         string | null
  foundedDate?:   string | null
  dissolvedDate?: string | null
  country?:       string | null
}>()
</script>

<style scoped>
.page-header {
  padding: var(--space-md);
  background: var(--paper-raised);
  border-bottom: 1px solid var(--rule);
}

.back-link {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  font-family: var(--font-sans);
  font-size: var(--size-label);
  font-weight: 500;
  color: var(--ink-soft);
  text-decoration: underline;
  text-decoration-color: var(--rule);
  text-underline-offset: 3px;
  margin-bottom: var(--space-sm);
}
.back-link:hover { color: var(--faded-red); text-decoration-color: var(--faded-red); }

.org-title-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-wrap: wrap;
}

.color-dot {
  width: 14px;
  height: 14px;
  border-radius: var(--radius-pill);
  flex-shrink: 0;
}

.org-name {
  font-family: var(--font-serif);
  font-size: var(--size-display);
  font-weight: 600;
  color: var(--ink);
  margin: 0;
  line-height: var(--leading-tight);
  letter-spacing: var(--tracking-tight);
  overflow-wrap: break-word;
}

.abbr-badge {
  display: inline-block;
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: var(--tracking-caps);
  color: var(--ink-soft);
  background: var(--paper-sunken);
  border-radius: var(--radius-pill);
  padding: var(--space-xs) var(--space-sm);
  white-space: nowrap;
  flex-shrink: 0;
}

.org-meta {
  font-family: var(--font-serif);
  font-size: var(--size-body);
  color: var(--ink-soft);
  margin: var(--space-xs) 0 0;
  font-style: italic;
}

.org-period {
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--muted);
  margin: var(--space-sm) 0 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-md);
  font-variant-numeric: tabular-nums;
}

.org-country {
  display: inline-block;
  padding: var(--space-xs) var(--space-sm);
  background: var(--paper-sunken);
  border-radius: var(--radius-pill);
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--ink-soft);
}
</style>
