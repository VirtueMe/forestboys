<template>
  <nav class="nav">
    <div class="nav-inner">
      <router-link to="/" class="logo">Milorg 2</router-link>

      <!-- Desktop links -->
      <div class="links">
        <router-link
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="link"
          :class="{ active: isActive(item) }"
        >
          {{ item.label }}
        </router-link>
      </div>

      <!-- Mobile hamburger -->
      <button class="burger" :aria-label="open ? 'Lukk meny' : 'Åpne meny'" @click="open = !open">
        <span class="burger-icon">{{ open ? '✕' : '≡' }}</span>
      </button>
    </div>

    <!-- Mobile dropdown -->
    <div v-if="open" class="mobile-menu">
      <router-link
        v-for="item in navItems"
        :key="item.path"
        :to="item.path"
        class="mobile-link"
        :class="{ active: isActive(item) }"
        @click="open = false"
      >
        {{ item.label }}
      </router-link>
    </div>

    <!-- Backdrop -->
    <div v-if="open" class="backdrop" @click="open = false"></div>
  </nav>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'

interface NavItem {
  label: string
  path: string
  exact?: boolean
  detail?: string
}

const navItems: NavItem[] = [
  { label: 'Hjem',              path: '/',         exact: true },
  { label: 'Hendelsekatalog',   path: '/events',   detail: '/events' },
  { label: 'Kart',              path: '/map' },
  { label: 'Registre',          path: '/registre', detail: '/registre' },
  { label: 'Om oss',            path: '/about' },
]

const route = useRoute()
const open = ref(false)

watch(() => route.path, () => { open.value = false })

function isActive(item: NavItem): boolean {
  if (item.exact) return route.path === item.path
  if (route.path === item.path) return true
  if (route.path.startsWith(item.path + '/')) return true
  if (item.detail && route.path.startsWith(item.detail + '/')) return true
  return false
}
</script>

<style scoped>
.nav {
  height: var(--nav-height);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
  position: relative;
  z-index: 100;
}

.nav-inner {
  max-width: 1320px;
  margin: 0 auto;
  height: 100%;
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 16px;
}

.logo {
  font-size: 15px;
  font-weight: 700;
  color: var(--color-navy);
  text-decoration: none;
  letter-spacing: -0.01em;
  white-space: nowrap;
  flex-shrink: 0;
}

.logo:hover {
  opacity: 0.8;
}

/* Desktop links */
.links {
  display: none;
}

@media (min-width: 768px) {
  .links {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: 1;
    overflow: hidden;
  }
}

.link {
  font-size: 11px;
  font-weight: 500;
  color: var(--color-muted);
  text-decoration: none;
  padding: 5px 7px;
  border-radius: 4px;
  white-space: nowrap;
  transition: color 0.1s, background 0.1s;
}

.link:hover {
  color: var(--color-text);
  background: var(--color-bg);
}

.link.active {
  color: var(--color-navy);
  font-weight: 600;
  background: var(--color-bg);
}

/* Mobile hamburger */
.burger {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: auto;
  background: none;
  border: none;
  cursor: pointer;
  padding: 8px;
  color: var(--color-navy);
  border-radius: 4px;
}

.burger:hover {
  background: var(--color-bg);
}

.burger-icon {
  font-size: 20px;
  line-height: 1;
  display: block;
  width: 20px;
  text-align: center;
}

@media (min-width: 768px) {
  .burger {
    display: none;
  }
}

/* Mobile dropdown */
.mobile-menu {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  z-index: 101;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.mobile-link {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text);
  text-decoration: none;
  padding: 14px 20px;
  border-bottom: 1px solid var(--color-border);
  transition: background 0.1s;
}

.mobile-link:last-child {
  border-bottom: none;
}

.mobile-link:hover {
  background: var(--color-bg);
}

.mobile-link.active {
  color: var(--color-navy);
  font-weight: 700;
  background: var(--color-bg);
  border-left: 3px solid var(--color-navy);
  padding-left: 17px;
}

/* Backdrop */
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
}
</style>
