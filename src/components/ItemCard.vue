<template>
  <button class="item-card" @click="emit('select')">
    <div class="thumb">
      <img v-if="thumb" :src="thumb" :alt="title" loading="lazy" />
      <div v-else class="thumb-placeholder" :style="{ background: accentColor }"></div>
    </div>
    <div class="body">
      <p class="name">{{ title }}</p>
      <p v-if="subtitle" class="subtitle">{{ subtitle }}</p>
      <div v-if="tags.length" class="tags">
        <span v-for="tag in tags" :key="tag" class="tag">{{ tag }}</span>
      </div>
    </div>
  </button>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  title: string
  subtitle?: string
  thumb?: string
  tags?: string[]
  accentColor?: string
}>(), {
  tags: () => [],
  accentColor: 'var(--color-border)',
})

const emit = defineEmits<{ select: [] }>()
</script>

<style scoped>
.item-card {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  transition: background 0.1s;
  height: 72px;
  flex-shrink: 0;
}
.item-card:hover, .item-card:focus-visible {
  background: var(--color-bg);
  outline: none;
}
.thumb, .thumb-placeholder {
  width: 56px;
  height: 56px;
  border-radius: 4px;
  flex-shrink: 0;
  overflow: hidden;
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.body {
  flex: 1;
  min-width: 0;
}
.name {
  font-weight: 600;
  font-size: 13px;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--color-text);
}
.subtitle {
  font-size: 11px;
  color: var(--color-muted);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tags {
  display: flex;
  gap: 4px;
  margin-top: 4px;
  flex-wrap: nowrap;
  overflow: hidden;
}
.tag {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  color: var(--color-muted);
  white-space: nowrap;
}
</style>
