<template>
  <div v-if="images.length" class="photo-strip">
    <img
      v-for="(img, i) in visible"
      :key="img._key"
      :src="imgUrl(img, 180)"
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
import { SANITY_IMG } from '../config/sanity.ts'
import type { IdbGalleryImage } from '../types/idb.ts'

const props = withDefaults(defineProps<{
  images: IdbGalleryImage[]
  visibleCount?: number
}>(), { visibleCount: 5 })

const emit = defineEmits<{ open: [index: number] }>()

const visible = computed(() => props.images.slice(0, props.visibleCount))
const extra = computed(() => Math.max(0, props.images.length - props.visibleCount))

function imgUrl(img: IdbGalleryImage, size: number): string {
  // Ref format: image-{hash}-{WxH}-{ext}  →  {hash}-{WxH}.{ext}
  const path = img.asset._ref.replace(/^image-/, '').replace(/-([a-z]+)$/, '.$1')
  return `${SANITY_IMG}/${path}?w=${size}&h=${size}&fit=crop&auto=format`
}
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
  border: 1px solid var(--color-border);
}
.more {
  width: 90px;
  height: 90px;
  flex-shrink: 0;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-bg);
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
</style>
