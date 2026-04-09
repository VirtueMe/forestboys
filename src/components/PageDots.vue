<template>
  <div class="page-dots" role="tablist" :aria-label="`Side ${current + 1} av ${total}`">
    <button
      v-for="i in total"
      :key="i"
      class="dot"
      :class="{ active: i - 1 === current }"
      role="tab"
      :aria-selected="i - 1 === current"
      @click="emit('change', i - 1)"
    ></button>
  </div>
</template>

<script setup lang="ts">
defineProps<{ current: number; total: number }>()
const emit = defineEmits<{ change: [page: number] }>()
</script>

<style scoped>
.page-dots {
  display: flex;
  gap: 6px;
  align-items: center;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  border: none;
  background: var(--color-border-mid);
  cursor: pointer;
  padding: 0;
  transition: background 0.15s, transform 0.15s;
}
.dot.active {
  background: var(--color-navy);
  transform: scale(1.2);
}
</style>
