<template>
  <footer class="footer">
    <div class="footer-inner">
      <span class="org">Foreningen Motstandsbevegelsen i Norge 1940–1945</span>
      <span class="sep" aria-hidden="true">·</span>
      <span class="credit">Forskning: Jan Warberg &amp; Rolf G. Halvorsen</span>
      <span class="sep" aria-hidden="true">·</span>
      <span class="copy">&copy; {{ year }}</span>
    </div>
  </footer>
</template>

<script setup lang="ts">
const year = new Date().getFullYear()
</script>

<style scoped>
.footer {
  flex-shrink: 0;
  background: var(--color-surface);
  border-top: 1px solid var(--color-border);
  padding: 0 16px;
  height: 36px;
  display: flex;
  align-items: center;
}

.footer-inner {
  max-width: 1320px;
  width: 100%;
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
}

.org {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-navy);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.sep {
  font-size: 11px;
  color: var(--color-border-mid);
  flex-shrink: 0;
}

.credit {
  font-size: 11px;
  color: var(--color-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.copy {
  font-size: 11px;
  color: var(--color-muted);
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
