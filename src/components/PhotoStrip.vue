<template>
  <div v-if="images.length" class="photo-strip">
    <img
      v-for="(img, i) in visible"
      :key="img._key"
      :src="img.url"
      :alt="`Bilde ${i + 1}`"
      class="thumb"
      loading="lazy"
      @click="emit('open', i)"
    />
    <button v-if="extra > 0" class="more" @click="emit('open', visibleCount)">
      +{{ extra }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { IdbGalleryImage } from '../types/idb.ts'

const props = withDefaults(defineProps<{
  images: IdbGalleryImage[]
  visibleCount?: number
}>(), { visibleCount: 5 })

const emit = defineEmits<{ open: [index: number] }>()

const visible = computed(() => props.images.slice(0, props.visibleCount))
const extra = computed(() => Math.max(0, props.images.length - props.visibleCount))

</script>

<style scoped>
.photo-strip {
  display: flex;
  flex-shrink: 0;
  gap: 6px;
  padding: 8px 12px 16px;
  overflow-x: auto;
  scrollbar-width: none;
}
.photo-strip::-webkit-scrollbar { display: none; }
.thumb {
  width: 90px;
  height: 90px;
  object-fit: cover;
  border-radius: 4px;
  flex-shrink: 0;
  cursor: pointer;
  border: 1px solid var(--rule);
}
.more {
  width: 90px;
  height: 90px;
  flex-shrink: 0;
  border: 1px solid var(--rule);
  border-radius: 4px;
  background: var(--paper);
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
</style>
