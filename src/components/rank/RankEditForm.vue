<template>
  <form class="rank-form" @submit.prevent="save">
    <div class="form-heading">{{ createMode ? 'Ny grad' : 'Rediger grad' }}</div>

    <div class="form-row">
      <label class="form-label" for="rank-name">Navn</label>
      <input id="rank-name" v-model="draft.name" class="form-input" type="text" placeholder="f.eks. Løytnant" />
    </div>

    <div v-if="createMode" class="form-row">
      <label class="form-label" for="rank-slug">Slug</label>
      <div class="slug-stack">
        <input
          id="rank-slug"
          v-model="draft.slug"
          class="form-input form-input-mono"
          :class="`slug-${slugState}`"
          type="text"
          placeholder="kebab-case"
          @input="slugEdited = true"
        />
        <span v-if="slugTaken" class="slug-hint">Slug finnes allerede for en grad.</span>
      </div>
    </div>

    <div class="form-row">
      <label class="form-label" for="rank-abbr">Forkortelse</label>
      <input id="rank-abbr" v-model="draft.abbreviation" class="form-input form-input-short" type="text" placeholder="f.eks. Lt, F/O" />
    </div>

    <div class="form-row">
      <label class="form-label" for="rank-tier">Nivå</label>
      <div class="tier-stack">
        <input id="rank-tier" v-model="draft.tier" class="form-input form-input-short form-input-mono" type="text" inputmode="numeric" placeholder="1–20" />
        <span class="form-hint">Sammenlignbart på tvers av grener — Fenrik og Flying Officer er begge 4.</span>
      </div>
    </div>

    <div class="form-row">
      <label class="form-label" for="rank-branch">Gren</label>
      <select id="rank-branch" v-model="draft.branchSlug" class="form-input">
        <option value="">— ingen —</option>
        <option v-for="b in branches" :key="b.slug" :value="b.slug">{{ b.name }}</option>
      </select>
    </div>

    <div class="form-row">
      <label class="form-label" for="rank-country">Land</label>
      <div class="country-field">
        <span v-for="c in draft.countries" :key="c" class="country-chip">
          {{ c }}
          <button type="button" class="country-remove" :aria-label="`Fjern ${c}`" @click="removeCountry(c)">✕</button>
        </span>
        <input
          id="rank-country"
          v-model="countryInput"
          class="form-input form-input-code"
          :class="{ 'code-invalid': countryInput.trim().length === 2 && !countryValid }"
          type="text"
          list="rank-country-codes"
          maxlength="2"
          placeholder="NO"
          @keydown.enter.prevent="addCountry"
        />
        <button type="button" class="btn-add" :disabled="!countryValid" @click="addCountry">Legg til</button>
        <datalist id="rank-country-codes">
          <option v-for="c in countryCodes" :key="c" :value="c"></option>
        </datalist>
      </div>
    </div>

    <div v-if="error" class="form-error">{{ error }}</div>

    <div class="form-actions">
      <button type="button" class="btn-link" :disabled="saving" @click="emit('cancel')">Avbryt</button>
      <button type="submit" class="btn-primary" :disabled="saving || !canSave">
        {{ saving ? (createMode ? 'Oppretter…' : 'Lagrer…') : (createMode ? 'Opprett' : 'Lagre') }}
      </button>
    </div>
  </form>
</template>

<script setup lang="ts">
/**
 * RankEditForm — inline create/edit form for a Rank on /admin/ranks.
 * PATCH sends only changed fields; slug is set once at create and is
 * immutable afterwards (Person rank editors reference it). Land is the
 * rank's own country list, independent of Gren.
 */
import { ref, computed, watch } from 'vue'
import { authFetch } from '@/composables/useAuth.ts'
import { slugify, SLUG_RE } from '@/utils/slug.ts'

export interface RankRow {
  slug:         string
  name:         string
  abbreviation: string | null
  tier:         number | null
  countries:    string[] | null
  branchSlug:   string | null
}
export interface BranchOption { slug: string; name: string }

interface Draft {
  slug:         string
  name:         string
  abbreviation: string
  tier:         string
  countries:    string[]
  branchSlug:   string
}

const props = defineProps<{
  /** Absent in create mode. */
  rank?:     RankRow
  branches:  BranchOption[]
  /** Suggestions for the Land field — codes already used in the graph. */
  countryCodes: string[]
  /** Slugs already in use — create-mode collision check. */
  takenSlugs: string[]
}>()

const emit = defineEmits<{
  saved:  [rank: RankRow]
  cancel: []
}>()

const createMode = computed(() => !props.rank)

function toDraft(r?: RankRow): Draft {
  return {
    slug:         r?.slug ?? '',
    name:         r?.name ?? '',
    abbreviation: r?.abbreviation ?? '',
    tier:         r?.tier == null ? '' : String(r.tier),
    countries:    [...(r?.countries ?? [])],
    branchSlug:   r?.branchSlug ?? '',
  }
}

const baseline = toDraft(props.rank)
const draft    = ref<Draft>({ ...baseline, countries: [...baseline.countries] })
const saving   = ref(false)
const error    = ref<string | null>(null)
const slugEdited = ref(false)

watch(() => draft.value.name, (v) => {
  if (createMode.value && !slugEdited.value) draft.value.slug = slugify(v)
})

const slugTaken = computed(() => createMode.value && props.takenSlugs.includes(draft.value.slug.trim()))
const slugState = computed<'neutral' | 'invalid' | 'valid'>(() => {
  const s = draft.value.slug.trim()
  if (!s) return 'neutral'
  return SLUG_RE.test(s) && !slugTaken.value ? 'valid' : 'invalid'
})

/** Returns the parsed tier, or 'invalid' if non-empty and not an integer 1–20. */
function parseTier(v: string): number | null | 'invalid' {
  const t = v.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isInteger(n) && n >= 1 && n <= 20 ? n : 'invalid'
}

const countryInput = ref('')
const countryValid = computed(() => {
  const c = countryInput.value.trim().toUpperCase()
  return /^[A-Z]{2}$/.test(c) && !draft.value.countries.includes(c)
})
function addCountry() {
  if (!countryValid.value) return
  draft.value.countries.push(countryInput.value.trim().toUpperCase())
  countryInput.value = ''
}
function removeCountry(c: string) {
  draft.value.countries = draft.value.countries.filter(x => x !== c)
}

const sameCountries = (a: string[], b: string[]) => a.join(',') === b.join(',')

const dirty = computed(() =>
  (Object.keys(draft.value) as (keyof Draft)[]).some(k =>
    k === 'countries'
      ? !sameCountries(draft.value.countries, baseline.countries)
      : draft.value[k] !== baseline[k]),
)

const canSave = computed(() => {
  if (!draft.value.name.trim()) return false
  if (parseTier(draft.value.tier) === 'invalid') return false
  if (createMode.value) return slugState.value === 'valid'
  return dirty.value
})

async function save() {
  if (!canSave.value) return
  saving.value = true
  error.value  = null
  const f = draft.value
  const tier = parseTier(f.tier) as number | null
  try {
    if (createMode.value) {
      const slug = f.slug.trim()
      const res = await authFetch('/api/admin/ranks', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          canonicalName: f.name.trim(),
          abbreviation:  f.abbreviation.trim() || null,
          tier,
          countries:     f.countries,
          branchSlug:    f.branchSlug || null,
        }),
      })
      const out = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) { error.value = out.error ?? `HTTP ${res.status}`; return }
      emit('saved', {
        slug,
        name:         f.name.trim(),
        abbreviation: f.abbreviation.trim() || null,
        tier,
        countries:    f.countries.length ? [...f.countries] : null,
        branchSlug:   f.branchSlug || null,
      })
      return
    }

    const body: Record<string, unknown> = {}
    if (f.name         !== baseline.name)         body.canonicalName = f.name.trim()
    if (f.abbreviation !== baseline.abbreviation) body.abbreviation  = f.abbreviation.trim() || null
    if (f.tier         !== baseline.tier)         body.tier          = tier
    if (!sameCountries(f.countries, baseline.countries)) body.countries = f.countries
    if (f.branchSlug   !== baseline.branchSlug)   body.branchSlug    = f.branchSlug || null

    const res = await authFetch(`/api/admin/ranks/${encodeURIComponent(props.rank!.slug)}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    const out = await res.json().catch(() => ({})) as Partial<RankRow> & { error?: string }
    if (!res.ok) { error.value = out.error ?? `HTTP ${res.status}`; return }
    emit('saved', {
      slug:         props.rank!.slug,
      name:         out.name ?? f.name.trim(),
      abbreviation: out.abbreviation ?? null,
      tier:         out.tier ?? null,
      countries:    out.countries ?? null,
      branchSlug:   out.branchSlug ?? null,
    })
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.rank-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  padding: var(--space-md);
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
}
.form-heading {
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: var(--space-xs);
}
.form-row {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: var(--space-md);
  align-items: center;
}
.form-label {
  font-family: var(--font-sans);
  font-size: var(--size-label);
  font-weight: 500;
  color: var(--ink-soft);
}
.form-input {
  width: 100%;
  padding: var(--space-sm) var(--space-md);
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink);
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  box-sizing: border-box;
}
.form-input:focus { outline: 1px solid var(--focus); outline-offset: 0; border-color: var(--focus); }
.form-input-short { max-width: 160px; }
.form-input-mono  { font-family: var(--font-mono); font-size: var(--size-mono); }
.form-input.slug-valid   { color: var(--moss);   border-color: var(--moss); }
.form-input.slug-invalid { color: var(--danger); border-color: var(--danger); }

.country-field { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-xs); }
.country-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px 2px 8px;
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  background: var(--paper-raised);
  font-family: var(--font-mono);
  font-size: var(--size-mono);
  color: var(--ink);
}
.country-remove {
  border: none;
  background: transparent;
  padding: 0 2px;
  font-size: 11px;
  color: var(--muted);
  cursor: pointer;
}
.country-remove:hover { color: var(--danger); }
.form-input-code { width: 88px; text-transform: uppercase; font-family: var(--font-mono); font-size: var(--size-mono); }
.form-input.code-invalid { border-color: var(--danger); color: var(--danger); }
.btn-add {
  padding: var(--space-xs) var(--space-md);
  font-family: var(--font-sans);
  font-size: var(--size-label);
  background: transparent;
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  color: var(--ink-soft);
  cursor: pointer;
}
.btn-add:hover:not(:disabled) { border-color: var(--focus); color: var(--focus); }
.btn-add:disabled { opacity: 0.4; cursor: not-allowed; }
.slug-stack, .tier-stack { display: flex; flex-direction: column; gap: var(--space-xs); }
.slug-hint { font-family: var(--font-sans); font-size: var(--size-label); color: var(--danger); }
.form-hint { font-family: var(--font-sans); font-size: var(--size-label); color: var(--muted); }

.form-error {
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--danger);
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--danger);
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: var(--space-md);
  margin-top: var(--space-xs);
}
.btn-primary {
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
.btn-primary:hover:not(:disabled) { background: var(--faded-red-soft); }
.btn-primary:disabled { background: var(--paper-sunken); color: var(--muted); cursor: not-allowed; }
.btn-link {
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
.btn-link:hover { color: var(--faded-red); text-decoration-color: var(--faded-red); }

@media (max-width: 520px) { .form-row { grid-template-columns: 1fr; gap: var(--space-xs); } }
</style>
