<template>
  <router-link
    v-if="user?.role === 'admin'"
    :to="`/admin/pages/${slug}`"
    class="edit-btn"
    title="Rediger side"
  >
    Rediger
  </router-link>
</template>

<script setup lang="ts">
import { useAuth } from '../composables/useAuth.ts'

defineProps<{ slug: 'home' | 'about' }>()

const { user } = useAuth()
</script>

<style scoped>
.edit-btn {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 100;
  padding: 10px 16px;
  background: var(--color-navy);
  color: #fff;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.edit-btn:hover {
  opacity: 0.9;
}
</style>
