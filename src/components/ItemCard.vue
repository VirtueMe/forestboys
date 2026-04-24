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
  accentColor: 'var(--rule)',
})

const emit = defineEmits<{ select: [] }>()
</script>

<style scoped>
.item-card {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  width: 100%;
  padding: var(--space-sm);
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  cursor: pointer;
  text-align: left;
  transition: background 120ms ease-out, box-shadow 120ms ease-out;
  height: 72px;
  flex-shrink: 0;
}
.item-card:hover {
  background: var(--paper-sunken);
  box-shadow: var(--shadow-sm);
}
.item-card:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
.thumb, .thumb-placeholder {
  width: 56px;
  height: 56px;
  border-radius: var(--radius-md);
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
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: var(--size-body-ui);
  line-height: var(--leading-snug);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--ink);
}
.subtitle {
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--muted);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tags {
  display: flex;
  gap: var(--space-xs);
  margin-top: var(--space-xs);
  flex-wrap: nowrap;
  overflow: hidden;
}
.tag {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-pill);
  background: var(--paper-sunken);
  color: var(--ink-soft);
  white-space: nowrap;
}
</style>
