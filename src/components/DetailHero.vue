<template>
  <div class="hero" :class="{ 'hero--empty': !imageUrl }">
    <img
      v-if="imageUrl"
      :src="imageUrl"
      :alt="alt"
      class="hero-img"
      :itemprop="itemprop"
    />
    <span v-else-if="placeholder" class="hero-placeholder" aria-hidden="true">{{ placeholder }}</span>
  </div>
</template>

<script setup lang="ts">
/**
 * DetailHero — full-width 280px (200px on narrow) image strip at the top of
 * a detail page. When `imageUrl` is empty, reserves the same vertical space
 * with an optional `placeholder` (initials, codename, etc.) on a paper-tone
 * gradient. Caller passes `alt` for the image and an optional `itemprop`
 * for schema.org markup.
 */
withDefaults(defineProps<{
  imageUrl:    string | null
  alt?:        string
  placeholder?: string | null
  /** Optional schema.org itemprop (e.g. "image"). */
  itemprop?:   string | undefined
}>(), {
  alt:         '',
  placeholder: null,
  itemprop:    undefined,
})
</script>

<style scoped>
.hero {
  width: 100%;
  height: 360px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--paper-raised);
  border-bottom: 1px solid var(--rule);
}

.hero-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: center top;
  display: block;
}

.hero--empty {
  background: linear-gradient(135deg, var(--paper-raised) 0%, var(--paper) 100%);
  border-bottom: 1px solid var(--rule);
}

.hero-placeholder {
  font-family: var(--font-serif);
  font-size: 88px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--rule);
  font-variant: all-small-caps;
  user-select: none;
}

@media (max-width: 480px) {
  .hero { height: 260px; }
  .hero-placeholder { font-size: 64px; }
}
</style>
