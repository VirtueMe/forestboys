<template>
  <section class="edit-section">
    <h3 class="edit-section-heading">{{ label }}</h3>
    <SectionsEditor :sections="draft" />
  </section>

  <footer v-if="!hideSave && dirty" class="edit-save-bar">
    <span class="edit-save-prompt">Ser det bra ut?</span>
    <button type="button" class="edit-btn-primary" :disabled="saving" @click="save">
      {{ saving ? 'Lagrer…' : 'Lagre' }}
    </button>
    <button type="button" class="edit-link-revert" :disabled="saving" @click="revert">Angre</button>
  </footer>
  <div v-if="displayError" class="edit-save-error">{{ displayError }}</div>
  <div v-if="linkIssues.length" class="edit-link-issues" :class="{ refused: linksRefused }">
    <p class="edit-link-issues-lead">
      {{ linksRefused ? 'Lenker som ikke fungerer:' : 'Lagret. Disse lenkene fungerer ikke:' }}
    </p>
    <ul class="edit-link-issues-list">
      <li v-for="(l, i) in linkIssues" :key="`${l.source}:${l.stored}:${i}`">
        <span>
          «{{ l.text }}»
          <template v-if="l.verdict === 'empty'">har ingen mål.</template>
          <template v-else>peker til <code>{{ l.stored.trim() }}</code>.</template>
        </span>
        <button
          v-for="c in fixes(l)"
          :key="c.path"
          type="button"
          class="edit-link-fix"
          :title="`Pek lenken til ${c.path}`"
          @click="applyFix(l, c)"
        >
          Bruk {{ c.slug }}
        </button>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
/**
 * DescriptionEditor — owns a draft of `Section[]` for an entity's
 * Beskrivelse, the save bar, and the PATCH call.
 *
 * Parent passes the saved sections + the endpoint to PATCH. After save,
 * the component emits `saved` so the parent can update its source ref.
 *
 * The draft + dirty flag are exposed via defineExpose so the parent can
 * overlay them in a sibling DescriptionPreview while still in edit mode.
 */
import { ref, computed, watch } from 'vue'
import { authFetch } from '@/composables/useAuth.ts'
import SectionsEditor, { type Section } from '@/components/SectionsEditor.vue'
import { rewriteLink, type LinkIssue } from '@/utils/linkCheck.ts'
import type { SlugHit } from '@/utils/slugResolver.ts'

const props = withDefaults(defineProps<{
  /** Authoritative saved sections (sorted, hydrated). */
  saved:    Section[]
  /** PATCH endpoint URL. Body is `{ sections: [...] }`. */
  endpoint: string
  /** Heading shown above the editor. */
  label?:   string
  /** Hide the internal save bar — used during entity creation when the
   *  parent owns the save sequencing (POST entity → PATCH sections). */
  hideSave?: boolean
  /** Optional starting draft different from `saved`. When present, the
   *  editor mounts with `draft = initialDirtyDraft` and `baseline = saved`,
   *  so it shows up as dirty on first render. Used to seed the editor
   *  with a draft that failed to save during create — the user then
   *  retries via the normal save flow. */
  initialDirtyDraft?: Section[]
  /** Optional error message rendered alongside any internal error.
   *  Used to surface a "couldn't save during create" notice from the
   *  parent so the user knows why the editor opened pre-filled-and-dirty. */
  externalError?: string | null
}>(), {
  label: 'Beskrivelse',
})

const emit = defineEmits<{ saved: [sections: Section[]] }>()

function cloneSection(s: Section): Section {
  return {
    ...s,
    citations:   s.citations.map(c => ({ ...c, source: { ...c.source } })),
    sourcedFrom: s.sourcedFrom ? { ...s.sourcedFrom } : null,
  }
}

function signature(arr: Section[]): string {
  return JSON.stringify(
    [...arr].sort((a, b) => a.order - b.order).map(s => [
      s.order,
      s.content,
      s.citations.map(c => [c.inline, c.source.id]),
      s.sourcedFrom?.id ?? null,
    ]),
  )
}

const draft    = ref<Section[]>([])
const baseline = ref<Section[]>([])
const saving   = ref(false)
const error    = ref<string | null>(null)
/** Links the server refused (the save did not happen) or saved with a warning. */
const linkIssues  = ref<LinkIssue[]>([])
const linksRefused = ref(false)

function snapshot() {
  draft.value    = props.saved.map(cloneSection)
  baseline.value = props.saved.map(cloneSection)
  error.value    = null
  linkIssues.value = []
}

// Mount: if the parent passed an `initialDirtyDraft`, seed the editor
// with that draft and keep `baseline` synced to `saved` so it shows as
// dirty (the user explicitly needs to re-Lagre). Otherwise it's the
// usual saved → draft sync.
const holdingRecoveredDraft = ref(props.initialDirtyDraft != null)
if (holdingRecoveredDraft.value) {
  draft.value    = props.initialDirtyDraft!.map(cloneSection)
  baseline.value = props.saved.map(cloneSection)
} else {
  snapshot()
}

// While holding a recovered draft, don't let `saved` updates clobber
// the user's unsaved work — only update baseline so dirty signature
// compares correctly. After a successful save, the flag flips and the
// normal saved→draft sync resumes.
watch(() => props.saved, () => {
  if (holdingRecoveredDraft.value) {
    baseline.value = props.saved.map(cloneSection)
  } else {
    snapshot()
  }
}, { deep: true })

// Late-arriving recovery: the editor stays mounted across the
// /<kind>/new → /<kind>/<slug> navigation, so `initialDirtyDraft`
// may flip from null → sections after mount. Seed the draft when that
// happens (and only then — same prop transitioning back to null after
// a successful save shouldn't wipe the draft).
watch(() => props.initialDirtyDraft, (v, prev) => {
  if (v && !prev) {
    holdingRecoveredDraft.value = true
    draft.value    = v.map(cloneSection)
    baseline.value = props.saved.map(cloneSection)
  }
})

const dirty = computed(() => signature(draft.value) !== signature(baseline.value))

const displayError = computed(() => error.value ?? props.externalError ?? null)

function revert() {
  draft.value = baseline.value.map(cloneSection)
  error.value = null
  linkIssues.value = []
}

/** The pages a link could be pointed at: the one it should name, or those that fit equally well. */
const fixes = (l: LinkIssue): SlugHit[] => l.suggestion ? [l.suggestion] : l.candidates ?? []

/** Point the link at `to` in every section; the draft becomes dirty and is saved with Lagre. */
function applyFix(l: LinkIssue, to: SlugHit) {
  for (const s of draft.value) s.content = rewriteLink(s.content, l, to)
  linkIssues.value = linkIssues.value.filter(x => x !== l)
}

async function save() {
  saving.value = true
  error.value  = null
  linkIssues.value = []
  try {
    const payload = {
      sections: [...draft.value]
        .sort((a, b) => a.order - b.order)
        .map(s => ({
          order:         s.order,
          content:       s.content,
          citations:     s.citations.map(c => ({ inline: c.inline, sourceId: c.source.id })),
          sourcedFromId: s.sourcedFrom?.id ?? null,
        })),
    }
    const res = await authFetch(props.endpoint, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string; links?: LinkIssue[] }
      error.value = body.error ?? `HTTP ${res.status}`
      linksRefused.value = true
      linkIssues.value = body.links ?? []
      return
    }
    const done = await res.json().catch(() => ({})) as { warnings?: LinkIssue[] }
    linksRefused.value = false
    linkIssues.value = done.warnings ?? []
    const saved = draft.value.map(cloneSection)
    baseline.value = saved
    holdingRecoveredDraft.value = false
    emit('saved', saved)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

defineExpose({ draft, dirty })
</script>

<style scoped>
.edit-section {
  padding: var(--space-md);
  background: var(--paper-raised);
  border-bottom: 1px solid var(--rule);
}
.edit-section-heading {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--muted);
  margin: 0 0 var(--space-md);
}

.edit-save-bar {
  margin-top: var(--space-md);
  padding: var(--space-md);
  background: var(--paper-sunken);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  gap: var(--space-md);
}
.edit-save-prompt {
  flex: 1;
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink-soft);
  font-weight: 500;
}
.edit-btn-primary {
  padding: var(--space-sm) var(--space-lg);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  font-weight: 500;
  background: var(--faded-red);
  color: var(--paper);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
}
.edit-btn-primary:hover:not(:disabled) { background: var(--faded-red-soft); }
.edit-btn-primary:disabled { background: var(--paper); color: var(--muted); cursor: not-allowed; }
.edit-link-revert {
  background: transparent;
  border: none;
  padding: 0;
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--ink-soft);
  text-decoration: underline;
  text-decoration-color: var(--rule);
  text-underline-offset: 3px;
  cursor: pointer;
}
.edit-link-revert:hover { color: var(--faded-red); text-decoration-color: var(--faded-red); }
.edit-link-revert:disabled { opacity: 0.5; cursor: not-allowed; }

.edit-link-issues {
  margin-top: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  background: var(--paper-sunken);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--ink-soft);
}
.edit-link-issues.refused { border-color: var(--danger); }
.edit-link-issues-lead { margin: 0 0 var(--space-xs); font-weight: 600; color: var(--ink); }
.edit-link-issues-list { margin: 0; padding-left: 1.2em; display: flex; flex-direction: column; gap: 4px; }
.edit-link-issues code { font-size: 0.9em; }
.edit-link-fix {
  margin-left: 8px;
  font: inherit;
  color: var(--focus);
  background: none;
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  padding: 1px 8px;
  cursor: pointer;
}
.edit-link-fix:hover { border-color: var(--focus); }

.edit-save-error {
  margin-top: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  background: var(--paper-sunken);
  border: 1px solid var(--danger);
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--danger);
}
</style>
