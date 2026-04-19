<template>
  <div class="shell">
    <AppNav />
    <main class="page-content">
      <RouterView v-slot="{ Component }">
        <keep-alive>
          <component :is="Component" />
        </keep-alive>
      </RouterView>
    </main>
    <AppFooter v-if="!isMap" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import AppNav from './components/AppNav.vue'
import AppFooter from './components/AppFooter.vue'
import { useLocationCache } from './composables/useLocationCache.ts'

const route = useRoute()
const isMap = computed(() => route.path.startsWith('/map'))

// Kick off cache warm-up on app start, regardless of which page loads first.
useLocationCache()
</script>

<style scoped>
.shell {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.page-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  position: relative;
  display: flex;
  flex-direction: column;
}
</style>
