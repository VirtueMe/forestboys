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

      <!-- Login / access button -->
      <router-link to="/access" class="access-btn" :aria-label="user ? user.name : 'Logg inn'">
        <template v-if="user">
          <span class="access-initials">{{ user.name.charAt(0).toUpperCase() }}</span>
        </template>
        <template v-else>
          <svg class="access-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
          </svg>
        </template>
      </router-link>

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
import { useAuth } from '../composables/useAuth.ts'

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
  { label: 'Gjennomgang',       path: '/review' },
  { label: 'Om oss',            path: '/about' },
]

const route = useRoute()
const open = ref(false)
const { user } = useAuth()

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
  background: var(--paper-raised);
  border-bottom: 1px solid var(--rule);
  flex-shrink: 0;
  position: relative;
  z-index: 100;
}

.nav-inner {
  max-width: var(--content-max-width);
  margin: 0 auto;
  height: 100%;
  display: flex;
  align-items: center;
  padding: 0 var(--space-md);
  gap: var(--space-md);
}

.logo {
  font-family: var(--font-serif);
  font-size: var(--size-h3);
  font-weight: 600;
  color: var(--ink);
  text-decoration: none;
  letter-spacing: var(--tracking-tight);
  white-space: nowrap;
  flex-shrink: 0;
}

.logo:hover { color: var(--faded-red); }

/* Desktop links */
.links {
  display: none;
}

@media (min-width: 768px) {
  .links {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    flex: 1;
    overflow: hidden;
  }
}

.link {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--muted);
  text-decoration: none;
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-md);
  white-space: nowrap;
  transition: color 120ms ease-out, background 120ms ease-out;
}

.link:hover {
  color: var(--ink);
  background: var(--paper-sunken);
}

.link.active {
  color: var(--ink);
  background: var(--paper-sunken);
}

/* Access / login button */
.access-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: auto;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-pill);
  color: var(--ink-soft);
  text-decoration: none;
  background: var(--paper);
  border: 1px solid var(--rule);
  transition: color 120ms ease-out, border-color 120ms ease-out;
}

.access-btn:hover { color: var(--faded-red); border-color: var(--faded-red); }
.access-btn.router-link-active { border-color: var(--faded-red); color: var(--faded-red); }

.access-initials {
  font-family: var(--font-sans);
  font-size: var(--size-label);
  font-weight: 600;
  line-height: 1;
}

.access-icon {
  width: 16px;
  height: 16px;
}

@media (min-width: 768px) {
  .access-btn {
    margin-left: 0;
  }
}

/* Mobile hamburger */
.burger {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  cursor: pointer;
  padding: var(--space-sm);
  color: var(--ink);
  border-radius: var(--radius-md);
}

.burger:hover {
  background: var(--paper-sunken);
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
  background: var(--paper-raised);
  border-bottom: 1px solid var(--rule);
  display: flex;
  flex-direction: column;
  z-index: 101;
  box-shadow: var(--shadow-md);
}

.mobile-link {
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  font-weight: 500;
  color: var(--ink);
  text-decoration: none;
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--rule);
  transition: background 120ms ease-out;
}

.mobile-link:last-child {
  border-bottom: none;
}

.mobile-link:hover {
  background: var(--paper-sunken);
}

.mobile-link.active {
  color: var(--ink);
  font-weight: 600;
  background: var(--paper-sunken);
  border-left: 3px solid var(--faded-red);
  padding-left: calc(var(--space-lg) - 3px);
}

/* Backdrop */
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
}
</style>
