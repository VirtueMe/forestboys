<template>
  <section class="preview">
    <header class="preview-header">
      <RouterLink :to="`/admin/proposals/${bundleId}`" class="back-link">← Tilbake til forslag</RouterLink>
    </header>
    <EntityPreviewPanel
      :bundle-id="bundleId"
      :kind="kind"
      :slug="slug"
      @accepted="back"
      @denied="back"
    />
  </section>
</template>

<script setup lang="ts">
/**
 * /admin/proposals/:bundleId/preview/:kind/:slug — controller-view preview.
 *
 * The page around EntityPreviewPanel, which holds the kinds it can render
 * (the detail page of the kind, fed by the bundle). Accept or deny returns
 * to the bundle.
 */
import { useRoute, useRouter } from 'vue-router'
import EntityPreviewPanel from '@/components/EntityPreviewPanel.vue'

const route  = useRoute()
const router = useRouter()

const bundleId = String(route.params.bundleId)
const kind     = String(route.params.kind)
const slug     = String(route.params.slug)

function back(): void {
  void router.push(`/admin/proposals/${bundleId}`)
}
</script>

<style scoped>
.preview {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.preview-header {
  padding: var(--space-sm) var(--space-md);
  background: var(--paper-raised);
  border-bottom: 1px solid var(--rule);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
}
.back-link {
  color: var(--ink-soft);
  text-decoration: none;
}
.back-link:hover { color: var(--ink); }
</style>
