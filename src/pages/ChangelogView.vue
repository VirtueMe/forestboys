<template>
  <div class="changelog-page">
    <main class="changelog">
      <h1 class="page-title">Endringslogg</h1>
      <p class="intro">Du bruker <strong>{{ label }}</strong>.</p>

      <section v-if="since && since.commits.length" class="release since">
        <h2 class="release-head">
          <span class="release-version">Siden {{ since.tag }}</span>
        </h2>
        <ul class="items">
          <li v-for="c in since.commits" :key="c.hash">
            {{ c.subject }}
            (<a :href="commitUrl(REPO, c.hash)" target="_blank" rel="noopener noreferrer">{{ c.hash }}</a>)
          </li>
        </ul>
      </section>

      <p v-if="!releases.length" class="empty">Ingen utgivelser ennå.</p>

      <article v-for="r in releases" :id="`v${r.version}`" :key="r.version" class="release">
        <h2 class="release-head">
          <span class="release-version">v{{ r.version }}</span>
          <time class="release-date" :datetime="r.date">{{ r.date }}</time>
        </h2>
        <div v-for="s in r.sections" :key="s.title">
          <h3 class="section-title">{{ s.title }}</h3>
          <ul class="items">
            <li v-for="(item, i) in s.items" :key="i">
              <template v-for="(seg, j) in item" :key="j">
                <a v-if="seg.href" :href="seg.href" target="_blank" rel="noopener noreferrer">{{ seg.text }}</a>
                <strong v-else-if="seg.bold">{{ seg.text }}</strong>
                <template v-else>{{ seg.text }}</template>
              </template>
            </li>
          </ul>
        </div>
      </article>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import changelog from '../../CHANGELOG.md?raw'
import { parseChangelog } from '../utils/changelog.ts'
import { commitUrl } from '../utils/sinceRelease.ts'
import { versionLabel } from '../utils/versionLabel.ts'

const REPO  = 'VirtueMe/forestboys'
const since = __APP_SINCE__
const label = versionLabel(__APP_VERSION__, __APP_COMMIT__, since?.commits.length)

const releases = computed(() => parseChangelog(changelog))
</script>

<style scoped>
.changelog-page {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: var(--paper);
}

.changelog {
  max-width: 720px;
  margin: 0 auto;
  padding: var(--space-lg, 24px) var(--space-md);
  box-sizing: border-box;
}

.page-title { margin: 0 0 var(--space-sm); }
.intro { margin: 0 0 var(--space-md); font-size: 0.9rem; color: var(--ink-soft); }
.empty { color: var(--muted); }

.release { margin-bottom: var(--space-lg, 24px); scroll-margin-top: var(--space-md); }
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
