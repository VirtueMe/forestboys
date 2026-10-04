<template>
  <div class="page-header">
    <RouterLink to="/registre" class="back-link">&#x2039; Tilbake</RouterLink>
    <h1 class="person-name" itemprop="name">{{ title }}</h1>
    <p v-if="secretName" class="person-alias" itemprop="alternateName"><span class="alias-label">Dekknavn:</span> {{ secretName }}</p>
    <meta v-if="birthYear !== null && birthYear !== undefined" :content="String(birthYear)" itemprop="birthDate" />
    <p v-if="home || birthYear" class="person-meta">
      <span v-if="birthYear">Født {{ birthYear }}</span>
      <span v-if="home && birthYear" aria-hidden="true"> · </span>
      <span v-if="home" itemprop="homeLocation">{{ home }}</span>
    </p>
  </div>
</template>

<script setup lang="ts">
import { RouterLink } from 'vue-router'

defineProps<{
  title:       string
  secretName?: string | null
  birthYear?:  number | null
  home?:       string | null
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

.person-name {
  font-family: var(--font-serif);
  font-size: var(--size-h1);
  font-weight: 600;
  color: var(--ink);
  margin: 0 0 var(--space-xs);
  line-height: var(--leading-tight);
  letter-spacing: var(--tracking-tight);
  overflow-wrap: break-word;
}

.person-alias {
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--ink-soft);
  margin: 0;
  overflow-wrap: anywhere;
}
.alias-label { color: var(--muted); }

.person-meta {
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--muted);
  margin: var(--space-xs) 0 0;
}
</style>
