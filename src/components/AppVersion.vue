<template>
  <RouterLink
    to="/endringslogg"
    class="version"
    :title="`Bygget fra ${commit || 'ukjent commit'} — se hva som er nytt`"
  >
    {{ label }}
  </RouterLink>
</template>

<script setup lang="ts">
import { versionLabel } from '../utils/versionLabel.ts'

const commit = __APP_COMMIT__
const label  = versionLabel(__APP_VERSION__, commit, __APP_SINCE__?.commits.length)
</script>

<style scoped>
.version {
  flex-shrink: 0;
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  color: var(--muted);
  text-decoration: underline;
  text-decoration-color: var(--rule);
  text-underline-offset: 2px;
  white-space: nowrap;
}
.version:hover { color: var(--ink); text-decoration-color: currentColor; }
.version:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
</style>
