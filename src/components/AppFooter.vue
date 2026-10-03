<template>
  <footer class="footer">
    <div class="footer-inner">
      <span class="org">Foreningen Motstandsbevegelsen i Norge 1940–1945</span>
      <span class="sep" aria-hidden="true">·</span>
      <span class="credit">Forskning: Jan Warberg &amp; Rolf G. Halvorsen</span>
      <span class="sep" aria-hidden="true">·</span>
      <span class="copy">&copy; {{ year }}</span>
      <AppVersion />
    </div>
  </footer>
</template>

<script setup lang="ts">
import AppVersion from './AppVersion.vue'

const year = new Date().getFullYear()
</script>

<style scoped>
.footer {
  flex-shrink: 0;
  background: var(--paper-raised);
  border-top: 1px solid var(--rule);
  padding: 0 var(--space-md);
  height: 36px;
  display: flex;
  align-items: center;
}

.footer-inner {
  max-width: var(--content-max-width);
  width: 100%;
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  overflow: hidden;
}

.org {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  color: var(--ink-soft);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.sep {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  color: var(--rule);
  flex-shrink: 0;
}

.credit {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.copy {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  color: var(--muted);
  flex-shrink: 0;
  margin-left: auto;
}

/* On narrow screens, hide credit to preserve the org name */
@media (max-width: 599px) {
  .credit,
  .sep:nth-of-type(2) {
    display: none;
  }
}
</style>
