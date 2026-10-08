<template>
  <section class="bundle-page">
    <header class="bundle-header">
      <h1 class="bundle-title">Forslag</h1>
    </header>
    <BundleReviewPanel :bundle-id="bundleId" @deleted="leaveDeletedBundle(router, bundleId)" />
  </section>
</template>

<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import BundleReviewPanel from '@/components/BundleReviewPanel.vue'
import { leaveDeletedBundle } from '@/utils/proposalNav.ts'

const route    = useRoute()
const router   = useRouter()
const bundleId = String(route.params.bundleId)
</script>

<style scoped>
.bundle-page {
  max-width: 900px;
  margin: 0 auto;
  padding: var(--space-md);
}
.bundle-title {
  font-family: var(--font-serif);
  font-size: var(--size-h1);
  margin: 0 0 var(--space-md);
}
</style>
