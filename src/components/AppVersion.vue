<template>
  <button
    type="button"
    class="version"
    :title="`Bygget fra ${commit || 'ukjent commit'} — se hva som er nytt`"
    @click="open = true"
  >
    {{ label }}
  </button>

  <AppModal v-model="open" title="Endringslogg">
    <div class="log">
      <p class="intro">
        Du bruker <strong>{{ label }}</strong>. Versjonen er siste utgivelse dette bygget bygger på;
        koden etter siste utgivelse vises først når neste versjon er ute.
      </p>

      <p v-if="!releases.length" class="empty">Ingen utgivelser ennå.</p>

      <article v-for="r in releases" :key="r.version" class="release">
        <h3 class="release-head">
          <span class="release-version">v{{ r.version }}</span>
          <time class="release-date" :datetime="r.date">{{ r.date }}</time>
        </h3>
        <section v-for="s in r.sections" :key="s.title" class="section">
          <h4 class="section-title">{{ s.title }}</h4>
          <ul class="items">
            <li v-for="(item, i) in s.items" :key="i">
              <template v-for="(seg, j) in item" :key="j">
                <a v-if="seg.href" :href="seg.href" target="_blank" rel="noopener noreferrer">{{ seg.text }}</a>
                <strong v-else-if="seg.bold">{{ seg.text }}</strong>
                <template v-else>{{ seg.text }}</template>
              </template>
            </li>
          </ul>
        </section>
      </article>
    </div>
  </AppModal>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import AppModal from './AppModal.vue'
import changelog from '../../CHANGELOG.md?raw'
import { parseChangelog } from '../utils/changelog.ts'
import { versionLabel } from '../utils/versionLabel.ts'

const commit = __APP_COMMIT__
const label  = versionLabel(__APP_VERSION__, commit, __APP_SINCE__?.commits.length)
const open   = ref(false)

const releases = computed(() => parseChangelog(changelog))
</script>

<style scoped>
.version {
  flex-shrink: 0;
  padding: 0;
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  color: var(--muted);
  background: none;
  border: none;
  cursor: pointer;
  text-decoration: underline;
  text-decoration-color: var(--rule);
  text-underline-offset: 2px;
  white-space: nowrap;
}
.version:hover { color: var(--ink); text-decoration-color: currentColor; }
.version:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }

.log { padding: var(--space-md) var(--space-md) 0; }

.intro { margin: 0 0 var(--space-md); font-size: 0.9rem; color: var(--ink-soft); }
.empty { color: var(--muted); }

.release { margin-bottom: var(--space-lg, 24px); }
.release-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-sm);
  margin: 0 0 var(--space-xs, 4px);
  padding-bottom: var(--space-xs, 4px);
  border-bottom: 1px solid var(--rule);
  font-family: var(--font-sans);
}
.release-version { font-size: 1rem; font-weight: 700; color: var(--ink); }
.release-date    { font-size: var(--size-caps); color: var(--muted); }

.section-title {
  margin: var(--space-sm) 0 var(--space-xs, 4px);
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}

.items { margin: 0; padding-left: 1.1em; font-size: 0.9rem; line-height: 1.5; }
.items li { margin-bottom: 4px; }
.items a { color: var(--focus); }
</style>
