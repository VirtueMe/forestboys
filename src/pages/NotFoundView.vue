<template>
  <main class="not-found">
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div class="art" v-html="art"></div>
  </main>
</template>

<script setup lang="ts">
import art from '../assets/404.svg?raw'
</script>

<style scoped>
.not-found {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #F7F5F1; /* matches the 404.svg background */
}
.art {
  width: 100%;
  max-width: 800px;
}
.art :deep(svg) {
  display: block;
  width: 100%;
  height: auto;
}
</style>
