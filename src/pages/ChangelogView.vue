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

      <article v-for="r in visible" :id="`v${r.version}`" :key="r.version" class="release">
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

      <button v-if="remaining > 0" type="button" class="more" @click="showMore">
        Vis flere <span class="more-count">({{ remaining }} igjen)</span>
      </button>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import changelog from '../../CHANGELOG.md?raw'
import { parseChangelog } from '../utils/changelog.ts'
import { commitUrl } from '../utils/sinceRelease.ts'
import { versionLabel } from '../utils/versionLabel.ts'

const REPO  = 'VirtueMe/forestboys'
const since = __APP_SINCE__
const label = versionLabel(__APP_VERSION__, __APP_COMMIT__, since?.commits.length)

const releases = computed(() => parseChangelog(changelog))

// Paging is set by an admin (/admin/changelog); 5 and 5 until the answer arrives or if it never does.
const settings = ref({ initial: 5, step: 5 })
const extra    = ref(0)
const count    = computed(() => settings.value.initial + extra.value)
const visible  = computed(() => releases.value.slice(0, count.value))
const remaining = computed(() => Math.max(0, releases.value.length - count.value))

function showMore() {
  extra.value += settings.value.step
}

// #v0.1.0 opens the list far enough to include that release, then scrolls to it.
const route = useRoute()
async function revealHash() {
  const index = releases.value.findIndex(r => `#v${r.version}` === route.hash)
  if (index < 0) return
  extra.value = Math.max(extra.value, index + 1 - settings.value.initial)
  await nextTick()
  document.getElementById(route.hash.slice(1))?.scrollIntoView()
}
watch(() => route.hash, revealHash)

onMounted(async () => {
  try {
    const res = await fetch('/api/site-settings/changelog')
    if (res.ok) {
      const body = await res.json() as { initial?: number; step?: number }
      if (Number.isInteger(body.initial) && Number.isInteger(body.step)) {
        settings.value = { initial: body.initial!, step: body.step! }
      }
    }
  } catch { /* keep the defaults */ }
  await revealHash()
})
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

.more {
  padding: 8px 16px;
  font: inherit;
  font-family: var(--font-sans);
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--ink);
  background: transparent;
  border: 1px solid var(--rule);
  border-radius: 4px;
  cursor: pointer;
}
.more:hover { border-color: var(--focus); color: var(--focus); }
.more:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.more-count { font-weight: 400; color: var(--muted); }
</style>
