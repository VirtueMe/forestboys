<template>
  <div class="admin-shell">
    <aside class="admin-nav" :class="{ open: navOpen }">
      <div class="nav-header">
        <h2 class="nav-brand">Admin</h2>
        <button
          class="nav-toggle"
          type="button"
          aria-label="Lukk meny"
          @click="navOpen = false"
        >
          ✕
        </button>
      </div>

      <nav>
        <div class="nav-group">
          <div class="nav-group-label">Sider</div>
          <ul class="nav-list">
            <li v-for="p in PAGES" :key="p.slug">
              <router-link
                :to="`/admin/pages/${p.slug}`"
                class="nav-link nav-link-nested"
                active-class="active"
              >
                {{ p.label }}
              </router-link>
            </li>
          </ul>
        </div>

        <div class="nav-group">
          <div class="nav-group-label">Kilder</div>
          <ul class="nav-list">
            <li>
              <router-link to="/admin/sources" class="nav-link nav-link-nested" active-class="active">
                Alle kilder
              </router-link>
            </li>
          </ul>
        </div>

        <div class="nav-group">
          <div class="nav-group-label">Oppslag</div>
          <ul class="nav-list">
            <li>
              <router-link to="/admin/ranks" class="nav-link nav-link-nested" active-class="active">
                Grader
              </router-link>
            </li>
            <li>
              <router-link to="/admin/roles" class="nav-link nav-link-nested" active-class="active">
                Roller
              </router-link>
            </li>
          </ul>
        </div>

        <div class="nav-group">
          <div class="nav-group-label">Forslag</div>
          <ul class="nav-list">
            <li>
              <router-link to="/admin/proposals" class="nav-link nav-link-nested" active-class="active">
                Alle bundles
              </router-link>
            </li>
          </ul>
        </div>

        <div class="nav-group">
          <div class="nav-group-label">Gjennomgang</div>
          <ul class="nav-list">
            <li>
              <router-link to="/admin/review" class="nav-link nav-link-nested" active-class="active">
                Review-kø
              </router-link>
            </li>
          </ul>
        </div>
      </nav>

      <div class="nav-footer">
        <router-link to="/" class="nav-exit">← Til forsiden</router-link>
      </div>
    </aside>

    <div v-if="navOpen" class="nav-scrim" @click="navOpen = false"></div>

    <div class="admin-main">
      <header class="admin-topbar">
        <button
          class="burger"
          type="button"
          aria-label="Åpne meny"
          @click="navOpen = true"
        >
          ☰
        </button>
        <span class="crumb">{{ crumb }}</span>
      </header>
      <main class="admin-content">
        <router-view />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'

const PAGES = [
  { slug: 'home',  label: 'Hjem' },
  { slug: 'about', label: 'Om oss' },
] as const

const route = useRoute()
const navOpen = ref(false)

const crumb = computed(() => {
  if (route.path.startsWith('/admin/sources'))   return 'Kilder'
  if (route.path.startsWith('/admin/proposals')) return 'Forslag'
  if (route.path.startsWith('/admin/review'))    return 'Gjennomgang'
  const pageSlug = String(route.params.slug ?? '')
  const page = PAGES.find(p => p.slug === pageSlug)
  if (page) return `Sider · ${page.label}`
  return 'Admin'
})
</script>

<style scoped>
.admin-shell {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 220px 1fr;
  background: var(--paper);
}

.admin-nav {
  background: var(--paper-raised);
  border-right: 1px solid var(--rule);
  display: flex;
  flex-direction: column;
  padding: 16px 0;
  overflow-y: auto;
}

.nav-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px 12px;
}

.nav-brand {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted);
  margin: 0;
}

.nav-toggle {
  display: none;
  width: 24px;
  height: 24px;
  padding: 0;
  font-size: 14px;
  color: var(--muted);
  background: transparent;
  border: none;
  cursor: pointer;
}

.nav-group { padding: 8px 0; }

.nav-group-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  padding: 4px 16px;
}

.nav-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.nav-link {
  display: block;
  padding: 7px 16px;
  font-size: 13px;
  color: var(--ink);
  text-decoration: none;
}
.nav-link-nested { padding-left: 28px; }

.nav-link:hover { background: var(--paper); }

.nav-link.active {
  background: var(--focus);
  color: #fff;
  font-weight: 600;
}

.nav-footer {
  margin-top: auto;
  padding: 12px 16px;
  border-top: 1px solid var(--rule);
}

.nav-exit {
  font-size: 12px;
  color: var(--muted);
  text-decoration: none;
}
.nav-exit:hover { color: var(--focus); }

.nav-scrim {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 19;
}

.admin-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.admin-topbar {
  display: none;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: var(--paper-raised);
  border-bottom: 1px solid var(--rule);
}

.burger {
  width: 32px;
  height: 32px;
  padding: 0;
  font-size: 18px;
  background: transparent;
  border: 1px solid var(--rule);
  border-radius: 4px;
  cursor: pointer;
  color: var(--ink);
}

.crumb {
  font-size: 13px;
  font-weight: 600;
  color: var(--focus);
}

.admin-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

@media (max-width: 720px) {
  .admin-shell { grid-template-columns: 1fr; }
  .admin-nav {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: 260px;
    transform: translateX(-100%);
    transition: transform 0.2s;
    z-index: 20;
  }
  .admin-nav.open { transform: translateX(0); }
  .admin-nav.open + .nav-scrim { display: block; }
  .nav-toggle { display: inline-flex; align-items: center; justify-content: center; }
  .admin-topbar { display: flex; }
}
</style>
